import { getD1 } from "../../../db";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  authorizeDeleteRequest,
  DeleteAuthorizationError,
  getDeleteAuthorizationRuntimeEnv,
} from "../../lib/deleteAuthorization";
import { initialLubricationRecords } from "../../lib/initialLubricationRecords";
import type { DeviceAxleProfile } from "../../lib/deviceAxleProfile";
import type { LubricationRecord, LubricationRecordType } from "../../lib/lubricationExcel";
import type { LubricationRevision, MonitoredLubricationRecord } from "../../lib/lubricationMonitor";
import {
  enforceManualEntryRateLimit,
  getTurnstileRuntimeEnv,
  TurnstileRequestError,
  verifyTurnstileToken,
} from "../../lib/turnstile";

const INITIAL_BATCH_ID = "initial-excel-2026-08-19";
const MAX_IMPORT_RECORDS = 500;
type StoredMeasurementRow = {
  id: string;
  device_id: string;
  measured_at: string;
  oil_level: number;
  inspector: string;
  record_type: LubricationRecordType;
  refill_amount: number | null;
};

type StoredMonitorMeasurementRow = StoredMeasurementRow & {
  created_by: string;
  created_at: string;
  file_name: string;
};

type StoredRevisionRow = {
  id: string;
  measurement_id: string;
  revision_no: number;
  device_id: string;
  measured_at: string;
  oil_level: number;
  inspector: string;
  record_type: LubricationRecordType;
  refill_amount: number | null;
  correction_reason: string;
  corrected_by: string;
  created_by: string;
  created_at: string;
};

type StoredDeviceAxleProfileRow = {
  device_id: string;
  effective_date: string;
  stage_count: number;
  axle_count: number;
  created_at: string;
  updated_at: string;
};

type CorrectionPayload = {
  measurementId: string;
  correctedBy: string;
  correctionReason: string;
  record: LubricationRecord;
};

type DeletePayload = {
  measurementId: string;
  password: string;
};

type ImportConflict = {
  deviceId: string;
  measuredAt: string;
  existing: LubricationRecord;
  incoming: LubricationRecord;
};

type ManualEntryPayload = {
  submissionType: "manual";
  turnstileToken: unknown;
  record: unknown;
};

class ImportValidationError extends Error {
  constructor(public readonly details: string[]) {
    super(details[0] ?? "匯入資料格式錯誤。");
    this.name = "ImportValidationError";
  }
}

let databaseReady: Promise<void> | null = null;

function recordKey(record: Pick<LubricationRecord, "deviceId" | "measuredAt">) {
  return `${record.deviceId}|${record.measuredAt}`;
}

function recordsEqual(left: LubricationRecord, right: LubricationRecord) {
  return left.deviceId === right.deviceId
    && left.measuredAt === right.measuredAt
    && left.oilLevel === right.oilLevel
    && left.inspector === right.inspector
    && left.recordType === right.recordType
    && left.refillAmount === right.refillAmount;
}

function normalizeDeviceId(value: unknown) {
  const compact = String(value ?? "").trim().toUpperCase().replace(/[\s_-]/g, "");
  const match = compact.match(/^(MOK|LB)(\d{1,2})$/);
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isInteger(number) || number < 1 || number > 10) return null;
  return `${match[1]}${number}`;
}

function normalizeMeasuredAt(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) return null;
  const date = new Date(`${text}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== text) return null;
  return text;
}

function normalizeRecord(value: unknown, index: number): LubricationRecord {
  if (!value || typeof value !== "object") {
    throw new ImportValidationError([`第 ${index + 1} 筆資料不是有效物件。`]);
  }

  const raw = value as Record<string, unknown>;
  const deviceId = normalizeDeviceId(raw.deviceId);
  const measuredAt = normalizeMeasuredAt(raw.measuredAt);
  const oilLevel = typeof raw.oilLevel === "number" && Number.isFinite(raw.oilLevel)
    ? Number(raw.oilLevel.toFixed(2))
    : null;
  const inspector = String(raw.inspector ?? "").trim();
  const recordType = raw.recordType === "量測" || raw.recordType === "補油"
    ? raw.recordType
    : null;
  const refillAmount = raw.refillAmount === null || raw.refillAmount === undefined
    ? null
    : typeof raw.refillAmount === "number" && Number.isFinite(raw.refillAmount)
      ? Number(raw.refillAmount.toFixed(2))
      : Number.NaN;
  const errors: string[] = [];

  if (!deviceId) errors.push(`第 ${index + 1} 筆：設備編號不正確。`);
  if (!measuredAt) errors.push(`第 ${index + 1} 筆：量測時間不正確。`);
  if (oilLevel === null || oilLevel < 0) errors.push(`第 ${index + 1} 筆：油量必須是大於或等於 0 的數字。`);
  if (!inspector || inspector.length > 100) errors.push(`第 ${index + 1} 筆：檢修人員不可空白且不得超過 100 字。`);
  if (!recordType) errors.push(`第 ${index + 1} 筆：紀錄類型只能是「量測」或「補油」。`);
  if (recordType === "補油" && (!Number.isFinite(refillAmount) || refillAmount === null || refillAmount <= 0)) {
    errors.push(`第 ${index + 1} 筆：補油紀錄必須包含大於 0 的補油量。`);
  }
  if (recordType === "量測" && refillAmount !== null) {
    errors.push(`第 ${index + 1} 筆：量測紀錄的補油量必須保持空白。`);
  }
  if (errors.length) throw new ImportValidationError(errors);

  return {
    deviceId: deviceId!,
    measuredAt: measuredAt!,
    oilLevel: oilLevel!,
    inspector,
    recordType: recordType!,
    refillAmount: recordType === "補油" ? refillAmount : null,
  };
}

function parseImportPayload(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new ImportValidationError(["匯入內容不是有效的 JSON 物件。"]);
  }

  const payload = value as Record<string, unknown>;
  const fileName = String(payload.fileName ?? "").trim().slice(0, 180);
  const fileHash = String(payload.fileHash ?? "not-provided").trim().slice(0, 128);
  const rawRecords = Array.isArray(payload.records) ? payload.records : [];
  if (!fileName) throw new ImportValidationError(["缺少 Excel 檔名。"]);
  if (!rawRecords.length) throw new ImportValidationError(["Excel 沒有可匯入的紀錄。"]);
  if (rawRecords.length > MAX_IMPORT_RECORDS) {
    throw new ImportValidationError([`單次最多匯入 ${MAX_IMPORT_RECORDS} 筆，請拆成多個檔案。`]);
  }

  const recordsByKey = new Map<string, LubricationRecord>();
  let duplicateWithinFile = 0;
  const conflicts: string[] = [];
  rawRecords.forEach((rawRecord, index) => {
    const record = normalizeRecord(rawRecord, index);
    const key = recordKey(record);
    const previous = recordsByKey.get(key);
    if (!previous) {
      recordsByKey.set(key, record);
      return;
    }
    if (recordsEqual(previous, record)) {
      duplicateWithinFile += 1;
      return;
    }
    conflicts.push(`${record.deviceId} 在 ${record.measuredAt.slice(0, 10)} 同一天出現內容不同的紀錄。`);
  });

  if (conflicts.length) throw new ImportValidationError(conflicts.slice(0, 12));
  return {
    fileName,
    fileHash,
    records: [...recordsByKey.values()],
    submittedCount: rawRecords.length,
    duplicateWithinFile,
  };
}

function isManualEntryPayload(value: unknown): value is ManualEntryPayload {
  return Boolean(
    value
    && typeof value === "object"
    && (value as Record<string, unknown>).submissionType === "manual",
  );
}

function parseManualEntryPayload(value: ManualEntryPayload) {
  const record = normalizeRecord(value.record, 0);
  return {
    fileName: `現場登記-${record.deviceId}-${record.measuredAt.slice(0, 10)}`,
    fileHash: `anonymous-pov-${crypto.randomUUID()}`,
    records: [record],
    submittedCount: 1,
    duplicateWithinFile: 0,
  };
}

function parseCorrectionPayload(value: unknown): CorrectionPayload {
  if (!value || typeof value !== "object") {
    throw new ImportValidationError(["更正內容不是有效的 JSON 物件。"]);
  }

  const payload = value as Record<string, unknown>;
  const measurementId = String(payload.measurementId ?? "").trim();
  const correctedBy = String(payload.correctedBy ?? "").trim();
  const correctionReason = String(payload.correctionReason ?? "").trim();
  const errors: string[] = [];
  if (!measurementId || measurementId.length > 180) errors.push("缺少要更正的紀錄 ID。");
  if (!correctedBy || correctedBy.length > 100) errors.push("更正人姓名為必填，且不得超過 100 字。");
  if (!correctionReason || correctionReason.length > 500) errors.push("更正原因為必填，且不得超過 500 字。");
  if (errors.length) throw new ImportValidationError(errors);

  return {
    measurementId,
    correctedBy,
    correctionReason,
    record: normalizeRecord(payload.record, 0),
  };
}

function parseDeletePayload(value: unknown): DeletePayload {
  if (!value || typeof value !== "object") {
    throw new ImportValidationError(["刪除內容不是有效的 JSON 物件。"]);
  }

  const payload = value as Record<string, unknown>;
  const measurementId = String(payload.measurementId ?? "").trim();
  const password = String(payload.password ?? "").trim();
  const errors: string[] = [];
  if (!measurementId || measurementId.length > 180) errors.push("缺少要刪除的紀錄 ID。");
  if (!password) errors.push("請輸入刪除密碼。");
  if (errors.length) throw new ImportValidationError(errors);
  return { measurementId, password };
}

function rowToRecord(row: StoredMeasurementRow): LubricationRecord {
  return {
    deviceId: row.device_id,
    measuredAt: row.measured_at,
    oilLevel: row.oil_level,
    inspector: row.inspector,
    recordType: row.record_type,
    refillAmount: row.refill_amount,
  };
}

function revisionRowToRecord(row: StoredRevisionRow): LubricationRecord {
  return {
    deviceId: row.device_id,
    measuredAt: row.measured_at,
    oilLevel: row.oil_level,
    inspector: row.inspector,
    recordType: row.record_type,
    refillAmount: row.refill_amount,
  };
}

function revisionRowToRevision(row: StoredRevisionRow): LubricationRevision {
  return {
    id: row.id,
    revisionNo: row.revision_no,
    ...revisionRowToRecord(row),
    correctionReason: row.correction_reason,
    correctedBy: row.corrected_by,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function rowToDeviceAxleProfile(row: StoredDeviceAxleProfileRow): DeviceAxleProfile {
  return {
    deviceId: row.device_id,
    effectiveDate: row.effective_date,
    stageCount: row.stage_count,
    axleCount: row.axle_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

async function initializeDatabase(d1: D1Database) {
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY NOT NULL,
      file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      submitted_count INTEGER NOT NULL,
      inserted_count INTEGER NOT NULL,
      duplicate_count INTEGER NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS measurements (
      id TEXT PRIMARY KEY NOT NULL,
      device_id TEXT NOT NULL,
      measured_at TEXT NOT NULL,
      oil_level REAL NOT NULL CHECK (oil_level >= 0),
      inspector TEXT NOT NULL,
      record_type TEXT NOT NULL CHECK (record_type IN ('量測', '補油')),
      refill_amount REAL,
      import_batch_id TEXT NOT NULL REFERENCES import_batches(id),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS measurement_revisions (
      id TEXT PRIMARY KEY NOT NULL,
      measurement_id TEXT NOT NULL REFERENCES measurements(id),
      revision_no INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      measured_at TEXT NOT NULL,
      oil_level REAL NOT NULL CHECK (oil_level >= 0),
      inspector TEXT NOT NULL,
      record_type TEXT NOT NULL CHECK (record_type IN ('量測', '補油')),
      refill_amount REAL,
      correction_reason TEXT NOT NULL,
      corrected_by TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS device_axle_profiles (
      device_id TEXT PRIMARY KEY NOT NULL,
      effective_date TEXT NOT NULL,
      stage_count INTEGER NOT NULL CHECK (stage_count > 0),
      axle_count INTEGER NOT NULL CHECK (axle_count > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS measurements_device_measured_at_uidx ON measurements (device_id, measured_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurements_measured_at ON measurements (measured_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurements_import_batch_id ON measurements (import_batch_id)"),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS measurement_revisions_measurement_revision_uidx ON measurement_revisions (measurement_id, revision_no)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurement_revisions_measurement_id ON measurement_revisions (measurement_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurement_revisions_created_at ON measurement_revisions (created_at)"),
  ]);

  const initialBatch = await d1.prepare("SELECT id FROM import_batches WHERE id = ? LIMIT 1")
    .bind(INITIAL_BATCH_ID)
    .first<{ id: string }>();
  if (initialBatch) return;

  await d1.batch([
    d1.prepare(`INSERT OR IGNORE INTO import_batches
      (id, file_name, file_hash, submitted_count, inserted_count, duplicate_count, uploaded_by)
      VALUES (?, ?, ?, ?, ?, 0, ?)`)
      .bind(
        INITIAL_BATCH_ID,
        "潤滑設備量測NEWW.xlsx",
        "initial-workbook-2026-08-19",
        initialLubricationRecords.length,
        initialLubricationRecords.length,
        "initial-excel",
      ),
    ...initialLubricationRecords.map((record) => d1.prepare(`INSERT OR IGNORE INTO measurements
      (id, device_id, measured_at, oil_level, inspector, record_type, refill_amount, import_batch_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        `initial:${recordKey(record)}`,
        record.deviceId,
        record.measuredAt,
        record.oilLevel,
        record.inspector,
        record.recordType,
        record.refillAmount,
        INITIAL_BATCH_ID,
        "initial-excel",
      )),
  ]);
}

async function ensureDatabase(d1: D1Database) {
  databaseReady ??= initializeDatabase(d1).catch((error) => {
    databaseReady = null;
    throw error;
  });
  await databaseReady;
}

async function listMeasurements(d1: D1Database) {
  const monitored = await listMonitoredMeasurements(d1);
  return monitored
    .map((item) => item.current)
    .sort((left, right) => left.measuredAt.localeCompare(right.measuredAt) || left.deviceId.localeCompare(right.deviceId, "en", { numeric: true }));
}

async function listDeviceAxleProfiles(d1: D1Database) {
  const result = await d1.prepare(`SELECT device_id, effective_date, stage_count, axle_count, created_at, updated_at
    FROM device_axle_profiles
    ORDER BY device_id ASC`).all<StoredDeviceAxleProfileRow>();
  return result.results.map(rowToDeviceAxleProfile);
}

async function listRevisionRows(d1: D1Database) {
  const result = await d1.prepare(`SELECT id, measurement_id, revision_no, device_id, measured_at, oil_level,
      inspector, record_type, refill_amount, correction_reason, corrected_by, created_by, created_at
    FROM measurement_revisions
    ORDER BY measurement_id ASC, revision_no ASC`).all<StoredRevisionRow>();
  return result.results;
}

async function listMonitoredMeasurements(d1: D1Database): Promise<MonitoredLubricationRecord[]> {
  const [measurementResult, revisionRows] = await Promise.all([
    d1.prepare(`SELECT m.id, m.device_id, m.measured_at, m.oil_level, m.inspector, m.record_type,
        m.refill_amount, m.created_by, m.created_at, b.file_name
      FROM measurements m
      JOIN import_batches b ON b.id = m.import_batch_id
      ORDER BY m.measured_at DESC, m.device_id ASC`).all<StoredMonitorMeasurementRow>(),
    listRevisionRows(d1),
  ]);
  const revisionsByMeasurement = new Map<string, LubricationRevision[]>();
  revisionRows.forEach((row) => {
    const revisions = revisionsByMeasurement.get(row.measurement_id) ?? [];
    revisions.push(revisionRowToRevision(row));
    revisionsByMeasurement.set(row.measurement_id, revisions);
  });

  return measurementResult.results.map((row) => {
    const original = rowToRecord(row);
    const revisions = revisionsByMeasurement.get(row.id) ?? [];
    const currentRevision = revisions.at(-1);
    return {
      id: row.id,
      original,
      current: currentRevision ? {
        deviceId: currentRevision.deviceId,
        measuredAt: currentRevision.measuredAt,
        oilLevel: currentRevision.oilLevel,
        inspector: currentRevision.inspector,
        recordType: currentRevision.recordType,
        refillAmount: currentRevision.refillAmount,
      } : original,
      status: revisions.length ? "已更正" : "有效",
      sourceType: row.file_name.startsWith("現場登記-") ? "現場登記" : "Excel 匯入",
      sourceName: row.file_name,
      createdBy: row.created_by,
      createdAt: row.created_at,
      revisions,
    };
  });
}

async function findExistingMeasurements(d1: D1Database, _records: LubricationRecord[]) {
  const existing = new Map<string, LubricationRecord>();
  const monitored = await listMonitoredMeasurements(d1);
  monitored.forEach((item) => {
    existing.set(recordKey(item.original), item.current);
    existing.set(recordKey(item.current), item.current);
  });
  return existing;
}

function conflictMessage(conflict: ImportConflict) {
  const date = conflict.incoming.measuredAt.slice(0, 10);
  return `${conflict.incoming.deviceId}｜${date} 已有 ${conflict.existing.oilLevel} L，Excel 為 ${conflict.incoming.oilLevel} L；為避免覆蓋歷史資料，本次未寫入。`;
}

export async function GET(request: Request) {
  try {
    const d1 = await getD1();
    await ensureDatabase(d1);
    if (new URL(request.url).searchParams.get("view") === "monitor") {
      const records = await listMonitoredMeasurements(d1);
      return Response.json({
        records,
        count: records.length,
        revisionCount: records.reduce((sum, item) => sum + item.revisions.length, 0),
      });
    }
    const [records, deviceAxleProfiles] = await Promise.all([
      listMeasurements(d1),
      listDeviceAxleProfiles(d1),
    ]);
    return Response.json({
      records,
      deviceAxleProfiles,
      count: records.length,
      latestMeasuredAt: records.at(-1)?.measuredAt ?? null,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "無法讀取永久資料庫。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const requestBody = await request.json();
    const user = await getChatGPTUser();
    const isManualEntry = isManualEntryPayload(requestBody);
    if (!isManualEntry && !user && !isLocalRequest(request)) {
      return Response.json({ error: "請先登入後再匯入 Excel。" }, { status: 401 });
    }

    if (isManualEntry) {
      const runtimeEnv = await getTurnstileRuntimeEnv();
      await enforceManualEntryRateLimit(request, runtimeEnv);
      await verifyTurnstileToken({
        request,
        runtimeEnv,
        token: requestBody.turnstileToken,
      });
    }

    const payload = isManualEntry
      ? parseManualEntryPayload(requestBody)
      : parseImportPayload(requestBody);
    const d1 = await getD1();
    await ensureDatabase(d1);
    const existing = await findExistingMeasurements(d1, payload.records);
    const newRecords: LubricationRecord[] = [];
    const conflicts: ImportConflict[] = [];
    let duplicateCount = payload.duplicateWithinFile;

    payload.records.forEach((record) => {
      const stored = existing.get(recordKey(record));
      if (!stored) {
        newRecords.push(record);
      } else if (recordsEqual(stored, record)) {
        duplicateCount += 1;
      } else {
        conflicts.push({ deviceId: record.deviceId, measuredAt: record.measuredAt, existing: stored, incoming: record });
      }
    });

    if (conflicts.length) {
      return Response.json({
        error: "發現同設備、同日期但內容不同的資料，本次整批沒有寫入。",
        conflicts: conflicts.slice(0, 12).map(conflictMessage),
      }, { status: 409 });
    }

    const batchId = crypto.randomUUID();
    const actor = isManualEntry ? "anonymous-pov" : user?.email ?? "local-development";
    await d1.batch([
      d1.prepare(`INSERT INTO import_batches
        (id, file_name, file_hash, submitted_count, inserted_count, duplicate_count, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(batchId, payload.fileName, payload.fileHash, payload.submittedCount, newRecords.length, duplicateCount, actor),
      ...newRecords.map((record) => d1.prepare(`INSERT INTO measurements
        (id, device_id, measured_at, oil_level, inspector, record_type, refill_amount, import_batch_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          record.deviceId,
          record.measuredAt,
          record.oilLevel,
          record.inspector,
          record.recordType,
          record.refillAmount,
          batchId,
          actor,
        )),
    ]);

    const records = await listMeasurements(d1);
    return Response.json({
      records,
      insertedCount: newRecords.length,
      duplicateCount,
      totalCount: records.length,
      latestMeasuredAt: records.at(-1)?.measuredAt ?? null,
    });
  } catch (error) {
    if (error instanceof TurnstileRequestError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ImportValidationError) {
      return Response.json({ error: "提交資料驗證失敗。", details: error.details }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "資料無法寫入永久資料庫。" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user && !isLocalRequest(request)) {
      return Response.json({ error: "目前連線無法寫入更正紀錄。" }, { status: 401 });
    }

    const payload = parseCorrectionPayload(await request.json());
    const d1 = await getD1();
    await ensureDatabase(d1);
    const monitored = await listMonitoredMeasurements(d1);
    const target = monitored.find((item) => item.id === payload.measurementId);
    if (!target) {
      return Response.json({ error: "找不到要更正的原始紀錄。" }, { status: 404 });
    }
    if (recordsEqual(target.current, payload.record)) {
      return Response.json({ error: "更正內容與目前有效資料完全相同，因此未新增版本。" }, { status: 400 });
    }

    const incomingKey = recordKey(payload.record);
    const collision = monitored.find((item) => item.id !== target.id && (
      recordKey(item.original) === incomingKey || recordKey(item.current) === incomingKey
    ));
    if (collision) {
      return Response.json({
        error: `${payload.record.deviceId}｜${payload.record.measuredAt.slice(0, 10)} 已屬於另一筆紀錄，請再確認設備與日期。`,
      }, { status: 409 });
    }

    const revisionNo = (target.revisions.at(-1)?.revisionNo ?? 0) + 1;
    const actor = user?.email ?? "local-development";
    const createdAt = new Date().toISOString();
    await d1.prepare(`INSERT INTO measurement_revisions
      (id, measurement_id, revision_no, device_id, measured_at, oil_level, inspector, record_type,
       refill_amount, correction_reason, corrected_by, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        target.id,
        revisionNo,
        payload.record.deviceId,
        payload.record.measuredAt,
        payload.record.oilLevel,
        payload.record.inspector,
        payload.record.recordType,
        payload.record.refillAmount,
        payload.correctionReason,
        payload.correctedBy,
        actor,
        createdAt,
      )
      .run();

    const records = await listMonitoredMeasurements(d1);
    return Response.json({
      records,
      count: records.length,
      revisionCount: records.reduce((sum, item) => sum + item.revisions.length, 0),
      correctedId: target.id,
    });
  } catch (error) {
    if (error instanceof ImportValidationError) {
      return Response.json({ error: "更正資料驗證失敗。", details: error.details }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "更正紀錄無法寫入永久資料庫。" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = parseDeletePayload(await request.json());
    await authorizeDeleteRequest({
      request,
      runtimeEnv: await getDeleteAuthorizationRuntimeEnv(),
      password: payload.password,
    });

    const d1 = await getD1();
    await ensureDatabase(d1);
    const monitored = await listMonitoredMeasurements(d1);
    const target = monitored.find((item) => item.id === payload.measurementId);
    if (!target) {
      return Response.json({ error: "找不到要刪除的紀錄。" }, { status: 404 });
    }

    await d1.batch([
      d1.prepare("DELETE FROM measurement_revisions WHERE measurement_id = ?").bind(target.id),
      d1.prepare("DELETE FROM measurements WHERE id = ?").bind(target.id),
    ]);

    const records = await listMonitoredMeasurements(d1);
    return Response.json({
      records,
      count: records.length,
      revisionCount: records.reduce((sum, item) => sum + item.revisions.length, 0),
      deletedId: target.id,
    });
  } catch (error) {
    if (error instanceof DeleteAuthorizationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ImportValidationError) {
      return Response.json({ error: "刪除資料驗證失敗。", details: error.details }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "紀錄無法從永久資料庫刪除。" },
      { status: 500 },
    );
  }
}
