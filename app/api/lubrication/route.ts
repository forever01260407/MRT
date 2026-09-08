import { getD1 } from "../../../db";
import { getActiveRequestUser } from "../../lib/authorizedUser";
import { initialLubricationRecords } from "../../lib/initialLubricationRecords";
import { ensureAuditEventsTable, prepareAuditEvent } from "../../lib/auditLog";
import { DEVICE_AXLE_PROFILE_TABLE_SQL, listDeviceAxleProfiles } from "../../lib/deviceAxleProfile";
import type { LubricationRecord, LubricationRecordType } from "../../lib/lubricationExcel";
import type { LubricationRevision, MonitoredLubricationRecord } from "../../lib/lubricationMonitor";
import { getRequestAuditContext } from "../../lib/requestContext";

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
  created_ip: string;
  created_at: string;
  file_name: string;
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_ip: string | null;
  delete_reason: string | null;
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
  source_ip: string;
  created_at: string;
};

type StoredLifecycleEventRow = {
  id: string;
  measurement_id: string;
  action: "deleted" | "restored";
  reason: string;
  actor: string;
  source_ip: string;
  created_at: string;
};

type CorrectionPayload = {
  measurementId: string;
  correctionReason: string;
  record: LubricationRecord;
};

type DeletePayload = {
  measurementId: string;
  deleteReason: string;
};

type RestorePayload = {
  measurementId: string;
  restoreReason: string;
};

type ImportConflict = {
  deviceId: string;
  measuredAt: string;
  existing: LubricationRecord;
  incoming: LubricationRecord;
};

type ManualEntryPayload = {
  submissionType: "manual";
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

function parseManualEntryPayload(value: ManualEntryPayload, inspector: string) {
  const recordSource = value.record && typeof value.record === "object"
    ? { ...(value.record as Record<string, unknown>), inspector }
    : value.record;
  const record = normalizeRecord(recordSource, 0);
  return {
    fileName: `現場登記-${record.deviceId}-${record.measuredAt.slice(0, 10)}`,
    fileHash: `signed-in-${crypto.randomUUID()}`,
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
  const correctionReason = String(payload.correctionReason ?? "").trim();
  const errors: string[] = [];
  if (!measurementId || measurementId.length > 180) errors.push("缺少要更正的紀錄 ID。");
  if (!correctionReason || correctionReason.length > 500) errors.push("更正原因為必填，且不得超過 500 字。");
  if (errors.length) throw new ImportValidationError(errors);

  return {
    measurementId,
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
  const deleteReason = String(payload.deleteReason ?? "").trim();
  const errors: string[] = [];
  if (!measurementId || measurementId.length > 180) errors.push("缺少要刪除的紀錄 ID。");
  if (!deleteReason || deleteReason.length > 500) errors.push("刪除原因為必填，且不得超過 500 字。");
  if (errors.length) throw new ImportValidationError(errors);
  return { measurementId, deleteReason };
}

function parseRestorePayload(value: unknown): RestorePayload {
  if (!value || typeof value !== "object") {
    throw new ImportValidationError(["還原內容不是有效的 JSON 物件。"]);
  }
  const payload = value as Record<string, unknown>;
  const measurementId = String(payload.measurementId ?? "").trim();
  const restoreReason = String(payload.restoreReason ?? "").trim();
  const errors: string[] = [];
  if (!measurementId || measurementId.length > 180) errors.push("缺少要還原的紀錄 ID。");
  if (!restoreReason || restoreReason.length > 500) errors.push("還原原因為必填，且不得超過 500 字。");
  if (errors.length) throw new ImportValidationError(errors);
  return { measurementId, restoreReason };
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
    sourceIp: row.source_ip,
    createdAt: row.created_at,
  };
}

function lifecycleRowToEvent(row: StoredLifecycleEventRow) {
  return {
    id: row.id,
    action: row.action,
    reason: row.reason,
    actor: row.actor,
    sourceIp: row.source_ip,
    createdAt: row.created_at,
  };
}

async function initializeDatabase(d1: D1Database) {
  await ensureAuditEventsTable(d1);
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
      created_ip TEXT NOT NULL DEFAULT '未知',
      deleted_at TEXT,
      deleted_by TEXT,
      deleted_ip TEXT,
      delete_reason TEXT,
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
      source_ip TEXT NOT NULL DEFAULT '未知',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS measurement_lifecycle_events (
      id TEXT PRIMARY KEY NOT NULL,
      measurement_id TEXT NOT NULL REFERENCES measurements(id),
      action TEXT NOT NULL CHECK (action IN ('deleted', 'restored')),
      reason TEXT NOT NULL,
      actor TEXT NOT NULL,
      source_ip TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(DEVICE_AXLE_PROFILE_TABLE_SQL),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS measurements_device_measured_at_uidx ON measurements (device_id, measured_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurements_measured_at ON measurements (measured_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurements_import_batch_id ON measurements (import_batch_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurements_deleted_at ON measurements (deleted_at)"),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS measurement_revisions_measurement_revision_uidx ON measurement_revisions (measurement_id, revision_no)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurement_revisions_measurement_id ON measurement_revisions (measurement_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurement_revisions_created_at ON measurement_revisions (created_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurement_lifecycle_events_measurement_created_at ON measurement_lifecycle_events (measurement_id, created_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurement_lifecycle_events_created_at ON measurement_lifecycle_events (created_at)"),
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
    .filter((item) => !item.deletion)
    .map((item) => item.current)
    .sort((left, right) => left.measuredAt.localeCompare(right.measuredAt) || left.deviceId.localeCompare(right.deviceId, "en", { numeric: true }));
}

async function listRevisionRows(d1: D1Database) {
  const result = await d1.prepare(`SELECT id, measurement_id, revision_no, device_id, measured_at, oil_level,
      inspector, record_type, refill_amount, correction_reason, corrected_by, created_by, source_ip, created_at
    FROM measurement_revisions
    ORDER BY measurement_id ASC, revision_no ASC`).all<StoredRevisionRow>();
  return result.results;
}

async function listLifecycleRows(d1: D1Database) {
  const result = await d1.prepare(`SELECT id, measurement_id, action, reason, actor, source_ip, created_at
    FROM measurement_lifecycle_events
    ORDER BY measurement_id ASC, created_at ASC, rowid ASC`).all<StoredLifecycleEventRow>();
  return result.results;
}

async function listMonitoredMeasurements(d1: D1Database): Promise<MonitoredLubricationRecord[]> {
  const [measurementResult, revisionRows, lifecycleRows] = await Promise.all([
    d1.prepare(`SELECT m.id, m.device_id, m.measured_at, m.oil_level, m.inspector, m.record_type,
        m.refill_amount, m.created_by, m.created_ip, m.created_at, m.deleted_at, m.deleted_by,
        m.deleted_ip, m.delete_reason, b.file_name
      FROM measurements m
      JOIN import_batches b ON b.id = m.import_batch_id
      ORDER BY m.measured_at DESC, m.device_id ASC`).all<StoredMonitorMeasurementRow>(),
    listRevisionRows(d1),
    listLifecycleRows(d1),
  ]);
  const revisionsByMeasurement = new Map<string, LubricationRevision[]>();
  revisionRows.forEach((row) => {
    const revisions = revisionsByMeasurement.get(row.measurement_id) ?? [];
    revisions.push(revisionRowToRevision(row));
    revisionsByMeasurement.set(row.measurement_id, revisions);
  });
  const lifecycleByMeasurement = new Map<string, ReturnType<typeof lifecycleRowToEvent>[]>();
  lifecycleRows.forEach((row) => {
    const events = lifecycleByMeasurement.get(row.measurement_id) ?? [];
    events.push(lifecycleRowToEvent(row));
    lifecycleByMeasurement.set(row.measurement_id, events);
  });

  return measurementResult.results.map((row) => {
    const original = rowToRecord(row);
    const revisions = revisionsByMeasurement.get(row.id) ?? [];
    const currentRevision = revisions.at(-1);
    const deletion = row.deleted_at && row.deleted_by && row.deleted_ip && row.delete_reason
      ? {
          deletedAt: row.deleted_at,
          deletedBy: row.deleted_by,
          deletedIp: row.deleted_ip,
          deleteReason: row.delete_reason,
        }
      : null;
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
      status: deletion ? "已失效" : revisions.length ? "已更正" : "有效",
      sourceType: row.file_name.startsWith("現場登記-") ? "現場登記" : "Excel 匯入",
      sourceName: row.file_name,
      createdBy: row.created_by,
      createdIp: row.created_ip,
      createdAt: row.created_at,
      revisions,
      deletion,
      lifecycleEvents: lifecycleByMeasurement.get(row.id) ?? [],
    };
  });
}

function buildMonitorPayload(allRecords: MonitoredLubricationRecord[]) {
  const records = allRecords.filter((item) => !item.deletion);
  const deletedRecords = allRecords.filter((item) => item.deletion);
  return {
    records,
    deletedRecords,
    count: records.length,
    deletedCount: deletedRecords.length,
    revisionCount: allRecords.reduce((sum, item) => sum + item.revisions.length, 0),
  };
}

async function findExistingMeasurements(d1: D1Database) {
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
      return Response.json(buildMonitorPayload(await listMonitoredMeasurements(d1)));
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
    const actor = await getActiveRequestUser(request);
    if (!actor) {
      return Response.json({ error: "請先登入後再寫入紀錄。" }, { status: 401 });
    }
    const requestBody = await request.json();
    const isManualEntry = isManualEntryPayload(requestBody);
    if (!isManualEntry && actor.role === "user") {
      return Response.json({ error: "只有 POWER USER 或 ADMIN 可以匯入 Excel。" }, { status: 403 });
    }

    const payload = isManualEntry
      ? parseManualEntryPayload(requestBody, actor.name)
      : parseImportPayload(requestBody);
    const d1 = await getD1();
    await ensureDatabase(d1);
    const existing = await findExistingMeasurements(d1);
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
    const createdBy = actor.username;
    const requestContext = getRequestAuditContext(request);
    const createdIp = requestContext.sourceIp;
    const storedRecords = newRecords.map((record) => ({ id: crypto.randomUUID(), record }));
    await d1.batch([
      d1.prepare(`INSERT INTO import_batches
        (id, file_name, file_hash, submitted_count, inserted_count, duplicate_count, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(batchId, payload.fileName, payload.fileHash, payload.submittedCount, newRecords.length, duplicateCount, createdBy),
      ...storedRecords.map(({ id, record }) => d1.prepare(`INSERT INTO measurements
        (id, device_id, measured_at, oil_level, inspector, record_type, refill_amount, import_batch_id, created_by, created_ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          id,
          record.deviceId,
          record.measuredAt,
          record.oilLevel,
          record.inspector,
          record.recordType,
          record.refillAmount,
          batchId,
          createdBy,
          createdIp,
        )),
      prepareAuditEvent(d1, {
        actorUsername: actor.username,
        actorRole: actor.role,
        ...requestContext,
        action: isManualEntry ? "lubrication.measurement_created" : "lubrication.excel_imported",
        resourceType: "import_batch",
        resourceId: batchId,
        resourceLabel: payload.fileName,
        after: isManualEntry
          ? { recordId: storedRecords[0]?.id ?? null, record: storedRecords[0]?.record ?? null }
          : {
              submittedCount: payload.submittedCount,
              insertedCount: newRecords.length,
              duplicateCount,
              recordIds: storedRecords.map((item) => item.id),
            },
        originType: "import_batch",
        originId: batchId,
      }),
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
    const actor = await getActiveRequestUser(request);
    if (!actor) {
      return Response.json({ error: "請先登入後再更正紀錄。" }, { status: 401 });
    }
    if (actor.role === "user") {
      return Response.json({ error: "只有 POWER USER 或 ADMIN 可以更正紀錄。" }, { status: 403 });
    }
    const payload = parseCorrectionPayload(await request.json());
    const d1 = await getD1();
    await ensureDatabase(d1);
    const monitored = await listMonitoredMeasurements(d1);
    const target = monitored.find((item) => item.id === payload.measurementId && !item.deletion);
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
    const createdAt = new Date().toISOString();
    const requestContext = getRequestAuditContext(request);
    const sourceIp = requestContext.sourceIp;
    const revisionId = crypto.randomUUID();
    await d1.batch([d1.prepare(`INSERT INTO measurement_revisions
      (id, measurement_id, revision_no, device_id, measured_at, oil_level, inspector, record_type,
       refill_amount, correction_reason, corrected_by, created_by, source_ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        revisionId,
        target.id,
        revisionNo,
        payload.record.deviceId,
        payload.record.measuredAt,
        payload.record.oilLevel,
        payload.record.inspector,
        payload.record.recordType,
        payload.record.refillAmount,
        payload.correctionReason,
        actor.name,
        actor.username,
        sourceIp,
        createdAt,
      )
      , prepareAuditEvent(d1, {
        actorUsername: actor.username,
        actorRole: actor.role,
        ...requestContext,
        action: "lubrication.measurement_corrected",
        resourceType: "measurement",
        resourceId: target.id,
        resourceLabel: `${payload.record.deviceId}｜${payload.record.measuredAt.slice(0, 10)}`,
        before: target.current,
        after: { ...payload.record, revisionNo },
        reason: payload.correctionReason,
        originType: "measurement_revision",
        originId: revisionId,
        occurredAt: createdAt,
      })]);

    return Response.json({
      ...buildMonitorPayload(await listMonitoredMeasurements(d1)),
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
    const actor = await getActiveRequestUser(request);
    if (!actor) {
      return Response.json({ error: "請先登入後再刪除紀錄。" }, { status: 401 });
    }
    if (actor.role === "user") {
      return Response.json({ error: "只有 POWER USER 或 ADMIN 可以刪除紀錄。" }, { status: 403 });
    }
    const payload = parseDeletePayload(await request.json());

    const d1 = await getD1();
    await ensureDatabase(d1);
    const monitored = await listMonitoredMeasurements(d1);
    const target = monitored.find((item) => item.id === payload.measurementId && !item.deletion);
    if (!target) {
      return Response.json({ error: "找不到要刪除的紀錄。" }, { status: 404 });
    }

    const deletedAt = new Date().toISOString();
    const requestContext = getRequestAuditContext(request);
    const sourceIp = requestContext.sourceIp;
    const lifecycleId = `LIFE-${crypto.randomUUID().toUpperCase()}`;
    await d1.batch([
      d1.prepare(`UPDATE measurements
        SET deleted_at = ?, deleted_by = ?, deleted_ip = ?, delete_reason = ?
        WHERE id = ? AND deleted_at IS NULL`)
        .bind(deletedAt, actor.username, sourceIp, payload.deleteReason, target.id),
      d1.prepare(`INSERT INTO measurement_lifecycle_events
        (id, measurement_id, action, reason, actor, source_ip, created_at)
        VALUES (?, ?, 'deleted', ?, ?, ?, ?)`)
        .bind(lifecycleId, target.id, payload.deleteReason, actor.username, sourceIp, deletedAt),
      prepareAuditEvent(d1, {
        actorUsername: actor.username,
        actorRole: actor.role,
        ...requestContext,
        action: "lubrication.measurement_soft_deleted",
        resourceType: "measurement",
        resourceId: target.id,
        resourceLabel: `${target.current.deviceId}｜${target.current.measuredAt.slice(0, 10)}`,
        before: { ...target.current, status: "active" },
        after: { ...target.current, status: "deleted" },
        reason: payload.deleteReason,
        originType: "measurement_lifecycle",
        originId: lifecycleId,
        occurredAt: deletedAt,
      }),
    ]);

    return Response.json({
      ...buildMonitorPayload(await listMonitoredMeasurements(d1)),
      deletedId: target.id,
    });
  } catch (error) {
    if (error instanceof ImportValidationError) {
      return Response.json({ error: "刪除資料驗證失敗。", details: error.details }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "紀錄無法標記為已刪除。" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await getActiveRequestUser(request);
    if (!actor) {
      return Response.json({ error: "請先登入後再還原紀錄。" }, { status: 401 });
    }
    if (actor.role === "user") {
      return Response.json({ error: "只有 POWER USER 或 ADMIN 可以從垃圾桶還原紀錄。" }, { status: 403 });
    }
    const payload = parseRestorePayload(await request.json());
    const d1 = await getD1();
    await ensureDatabase(d1);
    const monitored = await listMonitoredMeasurements(d1);
    const target = monitored.find((item) => item.id === payload.measurementId && item.deletion);
    if (!target) {
      return Response.json({ error: "找不到要還原的垃圾桶紀錄。" }, { status: 404 });
    }

    const restoredAt = new Date().toISOString();
    const requestContext = getRequestAuditContext(request);
    const sourceIp = requestContext.sourceIp;
    const lifecycleId = `LIFE-${crypto.randomUUID().toUpperCase()}`;
    await d1.batch([
      d1.prepare(`UPDATE measurements
        SET deleted_at = NULL, deleted_by = NULL, deleted_ip = NULL, delete_reason = NULL
        WHERE id = ? AND deleted_at IS NOT NULL`)
        .bind(target.id),
      d1.prepare(`INSERT INTO measurement_lifecycle_events
        (id, measurement_id, action, reason, actor, source_ip, created_at)
        VALUES (?, ?, 'restored', ?, ?, ?, ?)`)
        .bind(lifecycleId, target.id, payload.restoreReason, actor.username, sourceIp, restoredAt),
      prepareAuditEvent(d1, {
        actorUsername: actor.username,
        actorRole: actor.role,
        ...requestContext,
        action: "lubrication.measurement_restored",
        resourceType: "measurement",
        resourceId: target.id,
        resourceLabel: `${target.current.deviceId}｜${target.current.measuredAt.slice(0, 10)}`,
        before: { ...target.current, status: "deleted" },
        after: { ...target.current, status: "active" },
        reason: payload.restoreReason,
        originType: "measurement_lifecycle",
        originId: lifecycleId,
        occurredAt: restoredAt,
      }),
    ]);

    return Response.json({
      ...buildMonitorPayload(await listMonitoredMeasurements(d1)),
      restoredId: target.id,
    });
  } catch (error) {
    if (error instanceof ImportValidationError) {
      return Response.json({ error: "還原資料驗證失敗。", details: error.details }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "紀錄無法還原。" },
      { status: 500 },
    );
  }
}
