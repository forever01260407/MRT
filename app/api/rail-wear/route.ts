import { getD1 } from "../../../db";
import { getActiveRequestUser } from "../../lib/authorizedUser";
import { ensureAuditEventsTable, prepareAuditEvent } from "../../lib/auditLog";
import type {
  RailDirection,
  RailSide,
  RailWearMode,
  RailWearRecord,
  RailWearRecordFields,
  RailWearRecordType,
} from "../../lib/railWear";
import { getRequestAuditContext } from "../../lib/requestContext";

const USER_SELF_EDIT_WINDOW_MS = 30 * 60 * 1000;

type StoredRailWearRow = {
  id: string;
  mode: RailWearMode;
  direction: RailDirection;
  point_number: number;
  rail_side: RailSide;
  measured_at: string;
  wear: number;
  inspector: string;
  method: string;
  record_type: RailWearRecordType;
  note: string | null;
  created_by: string;
  created_ip: string;
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_ip: string | null;
  delete_reason: string | null;
  created_at: string;
};

type StoredRailWearRevisionRow = Omit<StoredRailWearRow, "id" | "created_ip" | "deleted_at" | "deleted_by" | "deleted_ip" | "delete_reason"> & {
  id: string;
  record_id: string;
  revision_no: number;
  correction_reason: string;
  corrected_by: string;
  source_ip: string;
};

type StoredRailWearLifecycleRow = {
  id: string;
  record_id: string;
  action: "deleted" | "restored";
  reason: string;
  actor: string;
  source_ip: string;
  created_at: string;
};

class RailWearValidationError extends Error {
  constructor(public readonly details: string[]) {
    super(details[0] ?? "軌道磨耗資料格式錯誤。");
    this.name = "RailWearValidationError";
  }
}

async function ensureRailWearLifecycleSchema(database: D1Database) {
  const columns = (await database.prepare("PRAGMA table_info(rail_wear_records)").all<{ name: string }>()).results;
  const columnNames = new Set(columns.map((column) => column.name));
  const repairs: D1PreparedStatement[] = [];
  if (!columnNames.has("deleted_at")) repairs.push(database.prepare("ALTER TABLE rail_wear_records ADD COLUMN deleted_at TEXT"));
  if (!columnNames.has("deleted_by")) repairs.push(database.prepare("ALTER TABLE rail_wear_records ADD COLUMN deleted_by TEXT"));
  if (!columnNames.has("deleted_ip")) repairs.push(database.prepare("ALTER TABLE rail_wear_records ADD COLUMN deleted_ip TEXT"));
  if (!columnNames.has("delete_reason")) repairs.push(database.prepare("ALTER TABLE rail_wear_records ADD COLUMN delete_reason TEXT"));
  if (repairs.length) await database.batch(repairs);
  await database.batch([
    database.prepare("CREATE INDEX IF NOT EXISTS idx_rail_wear_records_deleted_at ON rail_wear_records (deleted_at)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS rail_wear_lifecycle_events (
      id TEXT PRIMARY KEY NOT NULL,
      record_id TEXT NOT NULL REFERENCES rail_wear_records(id),
      action TEXT NOT NULL CHECK(action IN ('deleted', 'restored')),
      reason TEXT NOT NULL,
      actor TEXT NOT NULL,
      source_ip TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_rail_wear_lifecycle_record_created_at ON rail_wear_lifecycle_events (record_id, created_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_rail_wear_lifecycle_created_at ON rail_wear_lifecycle_events (created_at)"),
  ]);
}

function normalizeReason(value: unknown, label: string) {
  const reason = String(value ?? "").trim();
  if (!reason || reason.length > 500) {
    throw new RailWearValidationError([`${label}為必填，且不得超過 500 字。`]);
  }
  return reason;
}

function canDeleteRailWear(role: string) {
  return role === "userpro" || role === "supervisor" || role === "admin" || role === "root";
}

function canRestoreRailWear(role: string) {
  return role === "supervisor" || role === "admin" || role === "root";
}

function parseStoredTimestamp(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text ? text : null;
}

function normalizeFields(value: unknown): RailWearRecordFields {
  if (!value || typeof value !== "object") {
    throw new RailWearValidationError(["軌道磨耗內容不是有效的 JSON 物件。"]);
  }
  const raw = value as Record<string, unknown>;
  const mode = raw.mode === "tread" || raw.mode === "side" ? raw.mode : null;
  const direction = raw.direction === "up" || raw.direction === "down" ? raw.direction : null;
  const side = raw.side === "left" || raw.side === "right" ? raw.side : null;
  const recordType = raw.recordType === "measurement" || raw.recordType === "replacement" ? raw.recordType : null;
  const pointNumber = Number(raw.pointNumber);
  const measuredAt = normalizeDate(raw.measuredAt);
  const wear = typeof raw.wear === "number" && Number.isFinite(raw.wear) ? Number(raw.wear.toFixed(2)) : null;
  const inspector = String(raw.inspector ?? "").trim();
  const method = String(raw.method ?? "").trim();
  const noteText = String(raw.note ?? "").trim();
  const note = noteText ? noteText.slice(0, 500) : null;
  const errors: string[] = [];

  if (!mode) errors.push("磨耗類型只能是正面或側面。");
  if (!direction) errors.push("軌道方向只能是上行或下行。");
  if (!side) errors.push("軌別只能是左軌或右軌。");
  if (!recordType) errors.push("紀錄類型只能是量測或換軌。");
  const maximumPoint = direction === "down" ? 16 : 15;
  if (!Number.isInteger(pointNumber) || pointNumber < 1 || pointNumber > maximumPoint) {
    errors.push(`監測點必須介於 1 到 ${maximumPoint}。`);
  }
  if (!measuredAt) errors.push("請輸入有效的量測日期。");
  const maximumWear = mode === "side" ? 20 : 30;
  if (wear === null || wear < 0 || wear > maximumWear) {
    errors.push(`磨耗值必須介於 0 到 ${maximumWear} mm。`);
  }
  if (!inspector || inspector.length > 100) errors.push("量測人員不可空白且不得超過 100 字。");
  if (!method || method.length > 100) errors.push("量測方式不可空白且不得超過 100 字。");
  if (recordType === "replacement" && !note) errors.push("換軌紀錄必須填寫換軌說明或工單資訊。");
  if (String(raw.note ?? "").trim().length > 500) errors.push("備註不得超過 500 字。");
  if (errors.length) throw new RailWearValidationError(errors);

  return {
    mode: mode!,
    direction: direction!,
    pointNumber,
    side: side!,
    measuredAt: measuredAt!,
    wear: wear!,
    inspector,
    method,
    recordType: recordType!,
    note,
  };
}

function rowFields(row: StoredRailWearRow | StoredRailWearRevisionRow): RailWearRecordFields {
  return {
    mode: row.mode,
    direction: row.direction,
    pointNumber: row.point_number,
    side: row.rail_side,
    measuredAt: row.measured_at,
    wear: row.wear,
    inspector: row.inspector,
    method: row.method,
    recordType: row.record_type,
    note: row.note,
  };
}

function recordsEqual(left: RailWearRecordFields, right: RailWearRecordFields) {
  return left.mode === right.mode
    && left.direction === right.direction
    && left.pointNumber === right.pointNumber
    && left.side === right.side
    && left.measuredAt === right.measuredAt
    && left.wear === right.wear
    && left.inspector === right.inspector
    && left.method === right.method
    && left.recordType === right.recordType
    && left.note === right.note;
}

function recordKey(record: Pick<RailWearRecordFields, "mode" | "direction" | "pointNumber" | "side" | "measuredAt">) {
  return `${record.mode}|${record.direction}|${record.pointNumber}|${record.side}|${record.measuredAt}`;
}

function canEditRecord(actor: { username: string; role: string }, record: Pick<RailWearRecord, "createdBy" | "createdAt">) {
  if (actor.role !== "user") return true;
  const createdAt = parseStoredTimestamp(record.createdAt);
  return record.createdBy.trim().toLowerCase() === actor.username.trim().toLowerCase()
    && createdAt !== null
    && Date.now() <= createdAt + USER_SELF_EDIT_WINDOW_MS;
}

async function listRailWearRecords(
  database: D1Database,
  actor: { username: string; role: string },
  mode?: RailWearMode,
): Promise<RailWearRecord[]> {
  const rows = mode
    ? (await database.prepare(`SELECT id, mode, direction, point_number, rail_side, measured_at,
        wear, inspector, method, record_type, note, created_by, created_ip, deleted_at,
        deleted_by, deleted_ip, delete_reason, created_at
      FROM rail_wear_records WHERE mode = ?
      ORDER BY measured_at ASC, created_at ASC, rowid ASC`).bind(mode).all<StoredRailWearRow>()).results
    : (await database.prepare(`SELECT id, mode, direction, point_number, rail_side, measured_at,
        wear, inspector, method, record_type, note, created_by, created_ip, deleted_at,
        deleted_by, deleted_ip, delete_reason, created_at
      FROM rail_wear_records
      ORDER BY measured_at ASC, created_at ASC, rowid ASC`).all<StoredRailWearRow>()).results;
  if (!rows.length) return [];
  const revisions = (await database.prepare(`SELECT id, record_id, revision_no, mode, direction,
      point_number, rail_side, measured_at, wear, inspector, method, record_type, note,
      correction_reason, corrected_by, created_by, source_ip, created_at
    FROM rail_wear_revisions
    ORDER BY record_id ASC, revision_no ASC`).all<StoredRailWearRevisionRow>()).results;
  const latestRevision = new Map<string, StoredRailWearRevisionRow>();
  for (const revision of revisions) {
    if (rows.some((row) => row.id === revision.record_id)) latestRevision.set(revision.record_id, revision);
  }
  const lifecycleRows = (await database.prepare(`SELECT id, record_id, action, reason, actor, source_ip, created_at
    FROM rail_wear_lifecycle_events
    ORDER BY record_id ASC, created_at ASC, rowid ASC`).all<StoredRailWearLifecycleRow>()).results;
  const lifecycleByRecord = new Map<string, RailWearRecord["lifecycleEvents"]>();
  lifecycleRows.forEach((row) => {
    if (!rows.some((record) => record.id === row.record_id)) return;
    const events = lifecycleByRecord.get(row.record_id) ?? [];
    events.push({
      id: row.id,
      action: row.action,
      reason: row.reason,
      actor: row.actor,
      sourceIp: row.source_ip,
      createdAt: row.created_at,
    });
    lifecycleByRecord.set(row.record_id, events);
  });

  return rows.map((row) => {
    const revision = latestRevision.get(row.id);
    const effective = revision ? rowFields(revision) : rowFields(row);
    const record: RailWearRecord = {
      id: row.id,
      ...effective,
      revisionNo: revision?.revision_no ?? 0,
      correctionReason: revision?.correction_reason ?? null,
      correctedBy: revision?.corrected_by ?? null,
      createdBy: row.created_by,
      createdIp: row.created_ip,
      createdAt: row.created_at,
      updatedAt: revision?.created_at ?? row.created_at,
      canEdit: false,
      deletion: row.deleted_at && row.deleted_by && row.deleted_ip && row.delete_reason
        ? {
            deletedAt: row.deleted_at,
            deletedBy: row.deleted_by,
            deletedIp: row.deleted_ip,
            deleteReason: row.delete_reason,
          }
        : null,
      lifecycleEvents: lifecycleByRecord.get(row.id) ?? [],
    };
    record.canEdit = !record.deletion && canEditRecord(actor, record);
    return record;
  });
}

function buildRailWearPayload(records: RailWearRecord[]) {
  return {
    records: records.filter((record) => !record.deletion),
    deletedRecords: records.filter((record) => record.deletion),
  };
}

function parseMode(value: string | null): RailWearMode | undefined {
  return value === "tread" || value === "side" ? value : undefined;
}

function railLabel(record: RailWearRecordFields) {
  const modeLabel = record.mode === "tread" ? "正面" : "側面";
  const directionLabel = record.direction === "up" ? "上行" : "下行";
  const sideCode = record.side === "left" ? "L" : "R";
  return `${modeLabel}｜${directionLabel}${sideCode}${record.pointNumber}｜${record.measuredAt}`;
}

export async function GET(request: Request) {
  try {
    const actor = await getActiveRequestUser(request);
    if (!actor) return Response.json({ error: "請先登入後查看軌道磨耗資料。" }, { status: 401 });
    const mode = parseMode(new URL(request.url).searchParams.get("mode"));
    const database = await getD1();
    await ensureRailWearLifecycleSchema(database);
    const records = await listRailWearRecords(database, actor, mode);
    return Response.json(buildRailWearPayload(records), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "軌道磨耗資料暫時無法讀取。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActiveRequestUser(request);
    if (!actor) return Response.json({ error: "請先登入後登記軌道磨耗。" }, { status: 401 });
    const fields = normalizeFields(await request.json());
    const effectiveFields = actor.role === "user" ? { ...fields, inspector: actor.name } : fields;
    const database = await getD1();
    await ensureRailWearLifecycleSchema(database);
    const existing = await listRailWearRecords(database, actor, effectiveFields.mode);
    const duplicate = existing.find((record) => recordKey(record) === recordKey(effectiveFields));
    if (duplicate?.deletion) {
      return Response.json({ error: "這條軌道在同一天已有失效紀錄；請先從垃圾桶還原，再使用「更正」修改原紀錄。" }, { status: 409 });
    }
    if (duplicate) {
      return Response.json({ error: "這條軌道在同一天已有紀錄；請使用「更正」修改原紀錄。" }, { status: 409 });
    }
    await ensureAuditEventsTable(database);
    const id = `WEAR-${crypto.randomUUID().toUpperCase()}`;
    const createdAt = new Date().toISOString();
    const context = getRequestAuditContext(request);
    await database.batch([
      database.prepare(`INSERT INTO rail_wear_records (
          id, mode, direction, point_number, rail_side, measured_at, wear, inspector,
          method, record_type, note, created_by, created_ip, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          id,
          effectiveFields.mode,
          effectiveFields.direction,
          effectiveFields.pointNumber,
          effectiveFields.side,
          effectiveFields.measuredAt,
          effectiveFields.wear,
          effectiveFields.inspector,
          effectiveFields.method,
          effectiveFields.recordType,
          effectiveFields.note,
          actor.username,
          context.sourceIp,
          createdAt,
        ),
      prepareAuditEvent(database, {
        actorUsername: actor.username,
        actorRole: actor.role,
        ...context,
        action: effectiveFields.recordType === "replacement" ? "rail_wear.rail_replaced" : "rail_wear.measurement_created",
        resourceType: "rail_wear_record",
        resourceId: id,
        resourceLabel: railLabel(effectiveFields),
        after: effectiveFields,
        reason: effectiveFields.recordType === "replacement" ? effectiveFields.note : null,
        originType: "rail_wear_record",
        originId: id,
        occurredAt: createdAt,
      }),
    ]);
    const records = await listRailWearRecords(database, actor, effectiveFields.mode);
    return Response.json({ ...buildRailWearPayload(records), createdId: id }, { status: 201 });
  } catch (error) {
    if (error instanceof RailWearValidationError) {
      return Response.json({ error: "軌道磨耗資料驗證失敗。", details: error.details }, { status: 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "軌道磨耗紀錄無法寫入。" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await getActiveRequestUser(request);
    if (!actor) return Response.json({ error: "請先登入後更正軌道磨耗。" }, { status: 401 });
    const raw = await request.json() as Record<string, unknown>;
    const recordId = String(raw.recordId ?? "").trim();
    const correctionReason = String(raw.correctionReason ?? "").trim();
    if (!recordId || recordId.length > 180) {
      throw new RailWearValidationError(["缺少要更正的磨耗紀錄 ID。"]);
    }
    if (!correctionReason || correctionReason.length > 500) {
      throw new RailWearValidationError(["更正原因為必填，且不得超過 500 字。"]);
    }
    const fields = normalizeFields(raw.record);
    const effectiveFields = actor.role === "user" ? { ...fields, inspector: actor.name } : fields;
    const database = await getD1();
    await ensureRailWearLifecycleSchema(database);
    const records = await listRailWearRecords(database, actor);
    const target = records.find((record) => record.id === recordId);
    if (!target) return Response.json({ error: "找不到要更正的軌道磨耗紀錄。" }, { status: 404 });
    if (target.deletion) {
      return Response.json({ error: "這筆紀錄已在垃圾桶中；請先還原後再更正。" }, { status: 409 });
    }
    if (!target.canEdit) {
      return Response.json({ error: "USER 只能在提交後 30 分鐘內更正自己的紀錄。" }, { status: 403 });
    }
    if (recordsEqual(target, effectiveFields)) {
      return Response.json({ error: "更正內容與目前資料相同，因此未新增版本。" }, { status: 400 });
    }
    if (records.some((record) => !record.deletion && record.id !== target.id && recordKey(record) === recordKey(effectiveFields))) {
      return Response.json({ error: "更正後的軌道與日期已屬於另一筆紀錄。" }, { status: 409 });
    }

    await ensureAuditEventsTable(database);
    const revisionNo = target.revisionNo + 1;
    const revisionId = `WEAR-REV-${crypto.randomUUID().toUpperCase()}`;
    const createdAt = new Date().toISOString();
    const context = getRequestAuditContext(request);
    await database.batch([
      database.prepare(`INSERT INTO rail_wear_revisions (
          id, record_id, revision_no, mode, direction, point_number, rail_side, measured_at,
          wear, inspector, method, record_type, note, correction_reason, corrected_by,
          created_by, source_ip, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          revisionId,
          target.id,
          revisionNo,
          effectiveFields.mode,
          effectiveFields.direction,
          effectiveFields.pointNumber,
          effectiveFields.side,
          effectiveFields.measuredAt,
          effectiveFields.wear,
          effectiveFields.inspector,
          effectiveFields.method,
          effectiveFields.recordType,
          effectiveFields.note,
          correctionReason,
          actor.name,
          actor.username,
          context.sourceIp,
          createdAt,
        ),
      prepareAuditEvent(database, {
        actorUsername: actor.username,
        actorRole: actor.role,
        ...context,
        action: "rail_wear.record_corrected",
        resourceType: "rail_wear_record",
        resourceId: target.id,
        resourceLabel: railLabel(effectiveFields),
        before: {
          mode: target.mode,
          direction: target.direction,
          pointNumber: target.pointNumber,
          side: target.side,
          measuredAt: target.measuredAt,
          wear: target.wear,
          inspector: target.inspector,
          method: target.method,
          recordType: target.recordType,
          note: target.note,
          revisionNo: target.revisionNo,
        },
        after: { ...effectiveFields, revisionNo },
        reason: correctionReason,
        originType: "rail_wear_revision",
        originId: revisionId,
        occurredAt: createdAt,
      }),
    ]);
    const updatedRecords = await listRailWearRecords(database, actor, effectiveFields.mode);
    return Response.json({ ...buildRailWearPayload(updatedRecords), correctedId: target.id });
  } catch (error) {
    if (error instanceof RailWearValidationError) {
      return Response.json({ error: "更正資料驗證失敗。", details: error.details }, { status: 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "軌道磨耗紀錄無法更正。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await getActiveRequestUser(request);
    if (!actor) return Response.json({ error: "請先登入後刪除軌道磨耗紀錄。" }, { status: 401 });
    if (!canDeleteRailWear(actor.role)) {
      return Response.json({ error: "只有 AD USER、POWER USER、ADMIN 或 ROOT 可以將軌道紀錄移至垃圾桶。" }, { status: 403 });
    }
    const raw = await request.json() as Record<string, unknown>;
    const recordId = String(raw.recordId ?? "").trim();
    if (!recordId || recordId.length > 180) {
      throw new RailWearValidationError(["缺少要刪除的軌道磨耗紀錄 ID。"]);
    }
    const deleteReason = normalizeReason(raw.deleteReason, "刪除原因");
    const database = await getD1();
    await ensureRailWearLifecycleSchema(database);
    const records = await listRailWearRecords(database, actor);
    const target = records.find((record) => record.id === recordId);
    if (!target) return Response.json({ error: "找不到要刪除的軌道磨耗紀錄。" }, { status: 404 });
    if (target.deletion) return Response.json({ error: "這筆紀錄已在垃圾桶中。" }, { status: 409 });

    await ensureAuditEventsTable(database);
    const occurredAt = new Date().toISOString();
    const lifecycleId = `WEAR-LIFE-${crypto.randomUUID().toUpperCase()}`;
    const context = getRequestAuditContext(request);
    await database.batch([
      database.prepare(`UPDATE rail_wear_records
        SET deleted_at = ?, deleted_by = ?, deleted_ip = ?, delete_reason = ?
        WHERE id = ? AND deleted_at IS NULL`)
        .bind(occurredAt, actor.username, context.sourceIp, deleteReason, target.id),
      database.prepare(`INSERT INTO rail_wear_lifecycle_events
        (id, record_id, action, reason, actor, source_ip, created_at)
        VALUES (?, ?, 'deleted', ?, ?, ?, ?)`)
        .bind(lifecycleId, target.id, deleteReason, actor.username, context.sourceIp, occurredAt),
      prepareAuditEvent(database, {
        actorUsername: actor.username,
        actorRole: actor.role,
        ...context,
        action: "rail_wear.record_soft_deleted",
        resourceType: "rail_wear_record",
        resourceId: target.id,
        resourceLabel: railLabel(target),
        before: { status: "active", recordType: target.recordType, wear: target.wear },
        after: { status: "deleted" },
        reason: deleteReason,
        originType: "rail_wear_lifecycle",
        originId: lifecycleId,
        occurredAt,
      }),
    ]);
    const updatedRecords = await listRailWearRecords(database, actor, target.mode);
    return Response.json({ ...buildRailWearPayload(updatedRecords), deletedId: target.id });
  } catch (error) {
    if (error instanceof RailWearValidationError) {
      return Response.json({ error: "刪除資料驗證失敗。", details: error.details }, { status: 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "軌道磨耗紀錄無法刪除。" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await getActiveRequestUser(request);
    if (!actor) return Response.json({ error: "請先登入後還原軌道磨耗紀錄。" }, { status: 401 });
    if (!canRestoreRailWear(actor.role)) {
      return Response.json({ error: "只有 POWER USER、ADMIN 或 ROOT 可以從垃圾桶還原軌道紀錄。" }, { status: 403 });
    }
    const raw = await request.json() as Record<string, unknown>;
    const recordId = String(raw.recordId ?? "").trim();
    if (!recordId || recordId.length > 180) {
      throw new RailWearValidationError(["缺少要還原的軌道磨耗紀錄 ID。"]);
    }
    const restoreReason = normalizeReason(raw.restoreReason, "還原原因");
    const database = await getD1();
    await ensureRailWearLifecycleSchema(database);
    const records = await listRailWearRecords(database, actor);
    const target = records.find((record) => record.id === recordId);
    if (!target) return Response.json({ error: "找不到要還原的軌道磨耗紀錄。" }, { status: 404 });
    if (!target.deletion) return Response.json({ error: "這筆紀錄目前不是失效狀態。" }, { status: 409 });

    await ensureAuditEventsTable(database);
    const occurredAt = new Date().toISOString();
    const lifecycleId = `WEAR-LIFE-${crypto.randomUUID().toUpperCase()}`;
    const context = getRequestAuditContext(request);
    await database.batch([
      database.prepare(`UPDATE rail_wear_records
        SET deleted_at = NULL, deleted_by = NULL, deleted_ip = NULL, delete_reason = NULL
        WHERE id = ? AND deleted_at IS NOT NULL`).bind(target.id),
      database.prepare(`INSERT INTO rail_wear_lifecycle_events
        (id, record_id, action, reason, actor, source_ip, created_at)
        VALUES (?, ?, 'restored', ?, ?, ?, ?)`)
        .bind(lifecycleId, target.id, restoreReason, actor.username, context.sourceIp, occurredAt),
      prepareAuditEvent(database, {
        actorUsername: actor.username,
        actorRole: actor.role,
        ...context,
        action: "rail_wear.record_restored",
        resourceType: "rail_wear_record",
        resourceId: target.id,
        resourceLabel: railLabel(target),
        before: { status: "deleted" },
        after: { status: "active", recordType: target.recordType, wear: target.wear },
        reason: restoreReason,
        originType: "rail_wear_lifecycle",
        originId: lifecycleId,
        occurredAt,
      }),
    ]);
    const updatedRecords = await listRailWearRecords(database, actor, target.mode);
    return Response.json({ ...buildRailWearPayload(updatedRecords), restoredId: target.id });
  } catch (error) {
    if (error instanceof RailWearValidationError) {
      return Response.json({ error: "還原資料驗證失敗。", details: error.details }, { status: 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "軌道磨耗紀錄無法還原。" }, { status: 500 });
  }
}
