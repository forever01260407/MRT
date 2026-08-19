import { getD1 } from "../../../db";
import { getChatGPTUser } from "../../chatgpt-auth";
import { initialLubricationRecords } from "../../lib/initialLubricationRecords";
import type { LubricationRecord, LubricationRecordType } from "../../lib/lubricationExcel";

const INITIAL_BATCH_ID = "initial-excel-2026-08-19";
const MAX_IMPORT_RECORDS = 500;
const LOOKUP_CHUNK_SIZE = 50;

type StoredMeasurementRow = {
  id: string;
  device_id: string;
  measured_at: string;
  oil_level: number;
  inspector: string;
  record_type: LubricationRecordType;
  refill_amount: number | null;
};

type ImportConflict = {
  deviceId: string;
  measuredAt: string;
  existing: LubricationRecord;
  incoming: LubricationRecord;
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
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS measurements_device_measured_at_uidx ON measurements (device_id, measured_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurements_measured_at ON measurements (measured_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_measurements_import_batch_id ON measurements (import_batch_id)"),
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
  const result = await d1.prepare(`SELECT id, device_id, measured_at, oil_level, inspector, record_type, refill_amount
    FROM measurements
    ORDER BY measured_at ASC, device_id ASC`).all<StoredMeasurementRow>();
  return result.results.map(rowToRecord);
}

async function findExistingMeasurements(d1: D1Database, records: LubricationRecord[]) {
  const existing = new Map<string, LubricationRecord>();
  for (let offset = 0; offset < records.length; offset += LOOKUP_CHUNK_SIZE) {
    const chunk = records.slice(offset, offset + LOOKUP_CHUNK_SIZE);
    const results = await d1.batch<StoredMeasurementRow>(chunk.map((record) => d1
      .prepare(`SELECT id, device_id, measured_at, oil_level, inspector, record_type, refill_amount
        FROM measurements WHERE device_id = ? AND measured_at = ? LIMIT 1`)
      .bind(record.deviceId, record.measuredAt)));
    results.forEach((result) => {
      const row = result.results[0];
      if (row) existing.set(recordKey(rowToRecord(row)), rowToRecord(row));
    });
  }
  return existing;
}

function conflictMessage(conflict: ImportConflict) {
  const date = conflict.incoming.measuredAt.slice(0, 10);
  return `${conflict.incoming.deviceId}｜${date} 已有 ${conflict.existing.oilLevel} L，Excel 為 ${conflict.incoming.oilLevel} L；為避免覆蓋歷史資料，本次未寫入。`;
}

export async function GET() {
  try {
    const d1 = await getD1();
    await ensureDatabase(d1);
    const records = await listMeasurements(d1);
    return Response.json({ records, count: records.length, latestMeasuredAt: records.at(-1)?.measuredAt ?? null });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "無法讀取永久資料庫。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user && !isLocalRequest(request)) {
      return Response.json({ error: "請先登入後再匯入 Excel。" }, { status: 401 });
    }

    const payload = parseImportPayload(await request.json());
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
    const actor = user?.email ?? "local-development";
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
    if (error instanceof ImportValidationError) {
      return Response.json({ error: "匯入資料驗證失敗。", details: error.details }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Excel 無法寫入永久資料庫。" },
      { status: 500 },
    );
  }
}
