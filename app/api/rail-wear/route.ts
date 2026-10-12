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
  created_at: string;
};

type StoredRailWearRevisionRow = Omit<StoredRailWearRow, "id" | "created_ip"> & {
  id: string;
  record_id: string;
  revision_no: number;
  correction_reason: string;
  corrected_by: string;
  source_ip: string;
};

class RailWearValidationError extends Error {
  constructor(public readonly details: string[]) {
    super(details[0] ?? "軌道磨耗資料格式錯誤。");
    this.name = "RailWearValidationError";
  }
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
        wear, inspector, method, record_type, note, created_by, created_ip, created_at
      FROM rail_wear_records WHERE mode = ?
      ORDER BY measured_at ASC, created_at ASC, rowid ASC`).bind(mode).all<StoredRailWearRow>()).results
    : (await database.prepare(`SELECT id, mode, direction, point_number, rail_side, measured_at,
        wear, inspector, method, record_type, note, created_by, created_ip, created_at
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
    };
    record.canEdit = canEditRecord(actor, record);
    return record;
  });
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
    const records = await listRailWearRecords(database, actor, mode);
    return Response.json({ records }, { headers: { "Cache-Control": "no-store" } });
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
    const existing = await listRailWearRecords(database, actor, effectiveFields.mode);
    if (existing.some((record) => recordKey(record) === recordKey(effectiveFields))) {
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
    return Response.json({ records, createdId: id }, { status: 201 });
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
    const records = await listRailWearRecords(database, actor);
    const target = records.find((record) => record.id === recordId);
    if (!target) return Response.json({ error: "找不到要更正的軌道磨耗紀錄。" }, { status: 404 });
    if (!target.canEdit) {
      return Response.json({ error: "USER 只能在提交後 30 分鐘內更正自己的紀錄。" }, { status: 403 });
    }
    if (recordsEqual(target, effectiveFields)) {
      return Response.json({ error: "更正內容與目前資料相同，因此未新增版本。" }, { status: 400 });
    }
    if (records.some((record) => record.id !== target.id && recordKey(record) === recordKey(effectiveFields))) {
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
    return Response.json({ records: await listRailWearRecords(database, actor, effectiveFields.mode), correctedId: target.id });
  } catch (error) {
    if (error instanceof RailWearValidationError) {
      return Response.json({ error: "更正資料驗證失敗。", details: error.details }, { status: 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "軌道磨耗紀錄無法更正。" }, { status: 500 });
  }
}
