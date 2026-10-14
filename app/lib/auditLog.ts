export type AuditResult = "success" | "failure";

export type AuditContext = {
  actorUserId?: string | null;
  actorUsername: string;
  actorRole: string;
  sourceIp: string;
  userAgent?: string | null;
  requestId: string;
};

export type AuditEventInput = AuditContext & {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  resourceLabel?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  result?: AuditResult;
  errorCode?: string | null;
  metadata?: unknown;
  originType?: string | null;
  originId?: string | null;
  occurredAt?: string;
};

export type AuditEvent = {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorUsername: string;
  actorRole: string;
  sourceIp: string;
  userAgent: string | null;
  requestId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceLabel: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  result: AuditResult;
  errorCode: string | null;
  metadata: unknown;
  originType: string | null;
  originId: string | null;
  historical: boolean;
};

type StoredAuditEventRow = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_username: string;
  actor_role: string;
  source_ip: string;
  user_agent: string | null;
  request_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_label: string | null;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  result: AuditResult;
  error_code: string | null;
  metadata_json: string | null;
  origin_type: string | null;
  origin_id: string | null;
};

export const AUDIT_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id TEXT REFERENCES users(id),
  actor_username TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  source_ip TEXT NOT NULL,
  user_agent TEXT,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  resource_label TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  error_code TEXT,
  metadata_json TEXT,
  origin_type TEXT,
  origin_id TEXT
)`;

export async function ensureAuditEventsTable(database: D1Database) {
  await database.batch([
    database.prepare(AUDIT_EVENTS_TABLE_SQL),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at ON audit_events(occurred_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_audit_events_actor_occurred_at ON audit_events(actor_username, occurred_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_audit_events_action_occurred_at ON audit_events(action, occurred_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON audit_events(resource_type, resource_id)"),
    database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS audit_events_origin_uidx ON audit_events(origin_type, origin_id)"),
  ]);
}

function serializeAuditValue(value: unknown) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function parseAuditValue(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function truncate(value: string | null | undefined, maximum: number) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

export function prepareAuditEvent(database: D1Database, input: AuditEventInput) {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  return database.prepare(`INSERT INTO audit_events (
      id, occurred_at, actor_user_id, actor_username, actor_role, source_ip, user_agent, request_id,
      action, resource_type, resource_id, resource_label, before_json, after_json, reason, result,
      error_code, metadata_json, origin_type, origin_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      `AUD-${crypto.randomUUID().toUpperCase()}`,
      occurredAt,
      input.actorUserId ?? null,
      input.actorUsername.trim().slice(0, 120) || "unknown",
      input.actorRole.trim().slice(0, 80) || "unknown",
      input.sourceIp.trim().slice(0, 120) || "未知",
      truncate(input.userAgent, 500),
      input.requestId.trim().slice(0, 160) || crypto.randomUUID(),
      input.action.trim().slice(0, 120),
      input.resourceType.trim().slice(0, 80),
      truncate(input.resourceId, 180),
      truncate(input.resourceLabel, 240),
      serializeAuditValue(input.before),
      serializeAuditValue(input.after),
      truncate(input.reason, 500),
      input.result ?? "success",
      truncate(input.errorCode, 120),
      serializeAuditValue(input.metadata),
      truncate(input.originType, 80),
      truncate(input.originId, 180),
    );
}

export async function recordAuditEvent(database: D1Database, input: AuditEventInput) {
  await ensureAuditEventsTable(database);
  await prepareAuditEvent(database, input).run();
}

function rowToAuditEvent(row: StoredAuditEventRow, historical = false): AuditEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorUserId: row.actor_user_id,
    actorUsername: row.actor_username,
    actorRole: row.actor_role,
    sourceIp: row.source_ip,
    userAgent: row.user_agent,
    requestId: row.request_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceLabel: row.resource_label,
    before: parseAuditValue(row.before_json),
    after: parseAuditValue(row.after_json),
    reason: row.reason,
    result: row.result,
    errorCode: row.error_code,
    metadata: parseAuditValue(row.metadata_json),
    originType: row.origin_type,
    originId: row.origin_id,
    historical,
  };
}

function legacyEvent(input: Partial<AuditEvent> & Pick<AuditEvent, "id" | "occurredAt" | "actorUsername" | "action" | "resourceType" | "result" | "originType" | "originId">): AuditEvent {
  return {
    actorUserId: null,
    actorRole: "歷史未提供",
    sourceIp: "歷史未提供",
    userAgent: null,
    requestId: `legacy:${input.originType}:${input.originId}`,
    resourceId: null,
    resourceLabel: null,
    before: null,
    after: null,
    reason: null,
    errorCode: null,
    metadata: { historical: true },
    historical: true,
    ...input,
  };
}

async function listOptionalRows<T>(database: D1Database, query: string): Promise<T[]> {
  try {
    return (await database.prepare(query).all<T>()).results;
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) return [];
    throw error;
  }
}

export async function listUnifiedAuditEvents(database: D1Database, limit = 1000) {
  await ensureAuditEventsTable(database);
  const boundedLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
  const [stored, users, signIns, imports, revisions, lifecycle, axleEvents, railWearLifecycle] = await Promise.all([
    database.prepare(`SELECT id, occurred_at, actor_user_id, actor_username, actor_role, source_ip,
        user_agent, request_id, action, resource_type, resource_id, resource_label, before_json,
        after_json, reason, result, error_code, metadata_json, origin_type, origin_id
      FROM audit_events
      ORDER BY occurred_at DESC, rowid DESC
      LIMIT ?`).bind(boundedLimit).all<StoredAuditEventRow>(),
    database.prepare("SELECT id, username, role, status, created_by, created_at FROM users")
      .all<{ id: string; username: string; role: string; status: string; created_by: string; created_at: string }>(),
    database.prepare("SELECT id, user_id, username, success, outcome, source, user_agent, created_at FROM sign_in_events")
      .all<{ id: string; user_id: string | null; username: string; success: number; outcome: string; source: string; user_agent: string | null; created_at: string }>(),
    listOptionalRows<{ id: string; file_name: string; submitted_count: number; inserted_count: number; duplicate_count: number; uploaded_by: string; created_at: string; source_ip: string | null }>(database, `SELECT batch.id, batch.file_name, batch.submitted_count, batch.inserted_count,
        batch.duplicate_count, batch.uploaded_by, batch.created_at, MIN(measurement.created_ip) AS source_ip
      FROM import_batches batch
      LEFT JOIN measurements measurement ON measurement.import_batch_id = batch.id
      GROUP BY batch.id`),
    listOptionalRows<{ id: string; measurement_id: string; revision_no: number; device_id: string; measured_at: string; oil_level: number; inspector: string; record_type: string; refill_amount: number | null; correction_reason: string; corrected_by: string; source_ip: string; created_at: string }>(database, `SELECT id, measurement_id, revision_no, device_id, measured_at, oil_level,
        inspector, record_type, refill_amount, correction_reason, corrected_by, source_ip, created_at
      FROM measurement_revisions`),
    listOptionalRows<{ id: string; measurement_id: string; action: "deleted" | "restored"; reason: string; actor: string; source_ip: string; created_at: string }>(database,
      "SELECT id, measurement_id, action, reason, actor, source_ip, created_at FROM measurement_lifecycle_events"),
    listOptionalRows<{ id: string; device_id: string; previous_stage_count: number | null; stage_count: number; previous_axle_count: number | null; axle_count: number; previous_effective_date: string | null; effective_date: string; changed_by: string; source_ip: string; created_at: string }>(database, `SELECT id, device_id, previous_stage_count, stage_count, previous_axle_count,
        axle_count, previous_effective_date, effective_date, changed_by, source_ip, created_at
      FROM device_axle_profile_events`),
    listOptionalRows<{ id: string; record_id: string; action: "deleted" | "restored"; reason: string; actor: string; source_ip: string; created_at: string }>(database,
      "SELECT id, record_id, action, reason, actor, source_ip, created_at FROM rail_wear_lifecycle_events"),
  ]);

  const current = stored.results.map((row) => rowToAuditEvent(row));
  const origins = new Set(current.flatMap((event) => event.originType && event.originId ? [`${event.originType}:${event.originId}`] : []));
  const historical: AuditEvent[] = [];
  const addLegacy = (event: AuditEvent) => {
    const originKey = `${event.originType}:${event.originId}`;
    if (!origins.has(originKey)) historical.push(event);
  };

  users.results.forEach((user) => addLegacy(legacyEvent({
    id: `LEGACY-USER-${user.id}`,
    occurredAt: user.created_at,
    actorUsername: user.created_by === "system" ? "system" : user.created_by,
    action: "user.created",
    resourceType: "user",
    resourceId: user.id,
    resourceLabel: `@${user.username}`,
    after: { username: user.username, role: user.role, status: user.status },
    result: "success",
    originType: "user",
    originId: user.id,
  })));

  signIns.results.forEach((event) => addLegacy(legacyEvent({
    id: `LEGACY-SIGNIN-${event.id}`,
    occurredAt: event.created_at,
    actorUserId: event.user_id,
    actorUsername: event.username,
    sourceIp: event.source,
    userAgent: event.user_agent,
    action: event.success ? "auth.login_success" : "auth.login_failure",
    resourceType: "authentication",
    resourceId: event.user_id,
    resourceLabel: `@${event.username}`,
    after: { outcome: event.outcome },
    result: event.success ? "success" : "failure",
    errorCode: event.success ? null : event.outcome,
    originType: "sign_in_event",
    originId: event.id,
  })));

  imports.forEach((batch) => addLegacy(legacyEvent({
    id: `LEGACY-IMPORT-${batch.id}`,
    occurredAt: batch.created_at,
    actorUsername: batch.uploaded_by,
    sourceIp: batch.source_ip || "歷史未提供",
    action: batch.file_name.startsWith("現場登記-") ? "lubrication.measurement_created" : "lubrication.excel_imported",
    resourceType: "import_batch",
    resourceId: batch.id,
    resourceLabel: batch.file_name,
    after: { submittedCount: batch.submitted_count, insertedCount: batch.inserted_count, duplicateCount: batch.duplicate_count },
    result: "success",
    originType: "import_batch",
    originId: batch.id,
  })));

  revisions.forEach((revision) => addLegacy(legacyEvent({
    id: `LEGACY-REVISION-${revision.id}`,
    occurredAt: revision.created_at,
    actorUsername: revision.corrected_by,
    sourceIp: revision.source_ip,
    action: "lubrication.measurement_corrected",
    resourceType: "measurement",
    resourceId: revision.measurement_id,
    resourceLabel: `${revision.device_id}｜${revision.measured_at.slice(0, 10)}`,
    after: { revisionNo: revision.revision_no, deviceId: revision.device_id, measuredAt: revision.measured_at, oilLevel: revision.oil_level, inspector: revision.inspector, recordType: revision.record_type, refillAmount: revision.refill_amount },
    reason: revision.correction_reason,
    result: "success",
    originType: "measurement_revision",
    originId: revision.id,
  })));

  lifecycle.forEach((event) => addLegacy(legacyEvent({
    id: `LEGACY-LIFECYCLE-${event.id}`,
    occurredAt: event.created_at,
    actorUsername: event.actor,
    sourceIp: event.source_ip,
    action: event.action === "deleted" ? "lubrication.measurement_soft_deleted" : "lubrication.measurement_restored",
    resourceType: "measurement",
    resourceId: event.measurement_id,
    resourceLabel: event.measurement_id,
    before: { status: event.action === "deleted" ? "active" : "deleted" },
    after: { status: event.action === "deleted" ? "deleted" : "active" },
    reason: event.reason,
    result: "success",
    originType: "measurement_lifecycle",
    originId: event.id,
  })));

  axleEvents.forEach((event) => addLegacy(legacyEvent({
    id: `LEGACY-AXLE-${event.id}`,
    occurredAt: event.created_at,
    actorUsername: event.changed_by,
    sourceIp: event.source_ip,
    action: event.previous_stage_count === null ? "device_axle.created" : "device_axle.updated",
    resourceType: "device_axle_profile",
    resourceId: event.device_id,
    resourceLabel: event.device_id,
    before: event.previous_stage_count === null ? null : { stageCount: event.previous_stage_count, axleCount: event.previous_axle_count, effectiveDate: event.previous_effective_date },
    after: { stageCount: event.stage_count, axleCount: event.axle_count, effectiveDate: event.effective_date },
    result: "success",
    originType: "device_axle_profile_event",
    originId: event.id,
  })));

  railWearLifecycle.forEach((event) => addLegacy(legacyEvent({
    id: `LEGACY-RAIL-LIFECYCLE-${event.id}`,
    occurredAt: event.created_at,
    actorUsername: event.actor,
    sourceIp: event.source_ip,
    action: event.action === "deleted" ? "rail_wear.record_soft_deleted" : "rail_wear.record_restored",
    resourceType: "rail_wear_record",
    resourceId: event.record_id,
    resourceLabel: event.record_id,
    before: { status: event.action === "deleted" ? "active" : "deleted" },
    after: { status: event.action === "deleted" ? "deleted" : "active" },
    reason: event.reason,
    result: "success",
    originType: "rail_wear_lifecycle",
    originId: event.id,
  })));

  const sortableTimestamp = (value: string) => {
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
    return Date.parse(normalized) || 0;
  };
  return [...current, ...historical]
    .sort((left, right) => sortableTimestamp(right.occurredAt) - sortableTimestamp(left.occurredAt))
    .slice(0, boundedLimit);
}
