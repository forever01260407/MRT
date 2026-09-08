import { ensureAuditEventsTable, prepareAuditEvent } from "./auditLog";
import type { AuditContext } from "./auditLog";

export type DeviceAxleProfile = {
  deviceId: string;
  effectiveDate: string;
  stageCount: number;
  axleCount: number;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type DeviceAxleProfileInput = Pick<DeviceAxleProfile, "deviceId" | "effectiveDate" | "stageCount" | "axleCount" | "updatedBy"> & {
  sourceIp: string;
  audit: AuditContext;
};

export type DeviceAxleProfileEvent = {
  id: string;
  deviceId: string;
  previousStageCount: number | null;
  stageCount: number;
  previousAxleCount: number | null;
  axleCount: number;
  previousEffectiveDate: string | null;
  effectiveDate: string;
  changedBy: string;
  sourceIp: string;
  createdAt: string;
};

type StoredDeviceAxleProfileRow = {
  device_id: string;
  effective_date: string;
  stage_count: number;
  axle_count: number;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type StoredDeviceAxleProfileEventRow = {
  id: string;
  device_id: string;
  previous_stage_count: number | null;
  stage_count: number;
  previous_axle_count: number | null;
  axle_count: number;
  previous_effective_date: string | null;
  effective_date: string;
  changed_by: string;
  source_ip: string;
  created_at: string;
};

export const DEVICE_AXLE_PROFILE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS device_axle_profiles (
  device_id TEXT PRIMARY KEY NOT NULL,
  effective_date TEXT NOT NULL,
  stage_count INTEGER NOT NULL CHECK (stage_count > 0),
  axle_count INTEGER NOT NULL CHECK (axle_count > 0),
  updated_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const DEVICE_AXLE_PROFILE_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS device_axle_profile_events (
  id TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL,
  previous_stage_count INTEGER,
  stage_count INTEGER NOT NULL CHECK (stage_count > 0),
  previous_axle_count INTEGER,
  axle_count INTEGER NOT NULL CHECK (axle_count > 0),
  previous_effective_date TEXT,
  effective_date TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  source_ip TEXT NOT NULL DEFAULT '未知',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const DEVICE_AXLE_PROFILE_EVENTS_DEVICE_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_device_axle_profile_events_device_created_at ON device_axle_profile_events(device_id, created_at)";
const DEVICE_AXLE_PROFILE_EVENTS_CREATED_AT_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_device_axle_profile_events_created_at ON device_axle_profile_events(created_at)";

function rowToDeviceAxleProfile(row: StoredDeviceAxleProfileRow): DeviceAxleProfile {
  return {
    deviceId: row.device_id,
    effectiveDate: row.effective_date,
    stageCount: row.stage_count,
    axleCount: row.axle_count,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDeviceAxleProfileEvent(row: StoredDeviceAxleProfileEventRow): DeviceAxleProfileEvent {
  return {
    id: row.id,
    deviceId: row.device_id,
    previousStageCount: row.previous_stage_count,
    stageCount: row.stage_count,
    previousAxleCount: row.previous_axle_count,
    axleCount: row.axle_count,
    previousEffectiveDate: row.previous_effective_date,
    effectiveDate: row.effective_date,
    changedBy: row.changed_by,
    sourceIp: row.source_ip,
    createdAt: row.created_at,
  };
}

export async function ensureDeviceAxleProfileTable(d1: D1Database) {
  await ensureAuditEventsTable(d1);
  await d1.prepare(DEVICE_AXLE_PROFILE_TABLE_SQL).run();
  const columns = await d1.prepare("PRAGMA table_info(device_axle_profiles)")
    .all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "updated_by")) {
    await d1.prepare("ALTER TABLE device_axle_profiles ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'system'").run();
  }
  await d1.batch([
    d1.prepare(DEVICE_AXLE_PROFILE_EVENTS_TABLE_SQL),
    d1.prepare(DEVICE_AXLE_PROFILE_EVENTS_DEVICE_INDEX_SQL),
    d1.prepare(DEVICE_AXLE_PROFILE_EVENTS_CREATED_AT_INDEX_SQL),
  ]);
  const eventColumns = await d1.prepare("PRAGMA table_info(device_axle_profile_events)")
    .all<{ name: string }>();
  if (!eventColumns.results.some((column) => column.name === "previous_effective_date")) {
    await d1.prepare("ALTER TABLE device_axle_profile_events ADD COLUMN previous_effective_date TEXT").run();
  }
  if (!eventColumns.results.some((column) => column.name === "source_ip")) {
    await d1.prepare("ALTER TABLE device_axle_profile_events ADD COLUMN source_ip TEXT NOT NULL DEFAULT '未知'").run();
  }
  await d1.prepare(`INSERT OR IGNORE INTO device_axle_profile_events
    (id, device_id, previous_stage_count, stage_count, previous_axle_count, axle_count, previous_effective_date, effective_date, changed_by, source_ip, created_at)
    SELECT 'AXLE-BASELINE-' || profile.device_id, profile.device_id, NULL, profile.stage_count, NULL,
      profile.axle_count, NULL, profile.effective_date, profile.updated_by, '未知', profile.updated_at
    FROM device_axle_profiles profile
    WHERE NOT EXISTS (
      SELECT 1 FROM device_axle_profile_events event WHERE event.device_id = profile.device_id
    )`).run();
  await d1.prepare("PRAGMA optimize").run();
}

export async function listDeviceAxleProfiles(d1: D1Database) {
  const result = await d1.prepare(`SELECT device_id, effective_date, stage_count, axle_count, updated_by, created_at, updated_at
    FROM device_axle_profiles
    ORDER BY device_id ASC`).all<StoredDeviceAxleProfileRow>();
  return result.results.map(rowToDeviceAxleProfile);
}

export async function listDeviceAxleProfileEvents(d1: D1Database) {
  const result = await d1.prepare(`SELECT id, device_id, previous_stage_count, stage_count,
      previous_axle_count, axle_count, previous_effective_date, effective_date, changed_by, source_ip, created_at
    FROM device_axle_profile_events
    ORDER BY created_at DESC, rowid DESC`).all<StoredDeviceAxleProfileEventRow>();
  return result.results.map(rowToDeviceAxleProfileEvent);
}

export async function upsertDeviceAxleProfile(d1: D1Database, profile: DeviceAxleProfileInput) {
  const existing = await d1.prepare(`SELECT device_id, effective_date, stage_count, axle_count, updated_by, created_at, updated_at
    FROM device_axle_profiles
    WHERE device_id = ?
    LIMIT 1`).bind(profile.deviceId).first<StoredDeviceAxleProfileRow>();
  const upsert = d1.prepare(`INSERT INTO device_axle_profiles
    (device_id, effective_date, stage_count, axle_count, updated_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      effective_date = excluded.effective_date,
      stage_count = excluded.stage_count,
      axle_count = excluded.axle_count,
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP`)
    .bind(profile.deviceId, profile.effectiveDate, profile.stageCount, profile.axleCount, profile.updatedBy);
  const eventId = `AXLE-${crypto.randomUUID().toUpperCase()}`;
  const appendEvent = d1.prepare(`INSERT INTO device_axle_profile_events
    (id, device_id, previous_stage_count, stage_count, previous_axle_count, axle_count, previous_effective_date, effective_date, changed_by, source_ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      eventId,
      profile.deviceId,
      existing?.stage_count ?? null,
      profile.stageCount,
      existing?.axle_count ?? null,
      profile.axleCount,
      existing?.effective_date ?? null,
      profile.effectiveDate,
      profile.updatedBy,
      profile.sourceIp,
    );
  const appendAudit = prepareAuditEvent(d1, {
    ...profile.audit,
    action: existing ? "device_axle.updated" : "device_axle.created",
    resourceType: "device_axle_profile",
    resourceId: profile.deviceId,
    resourceLabel: profile.deviceId,
    before: existing ? {
      effectiveDate: existing.effective_date,
      stageCount: existing.stage_count,
      axleCount: existing.axle_count,
    } : null,
    after: {
      effectiveDate: profile.effectiveDate,
      stageCount: profile.stageCount,
      axleCount: profile.axleCount,
    },
    originType: "device_axle_profile_event",
    originId: eventId,
  });
  await d1.batch([upsert, appendEvent, appendAudit]);

  const stored = await d1.prepare(`SELECT device_id, effective_date, stage_count, axle_count, updated_by, created_at, updated_at
    FROM device_axle_profiles
    WHERE device_id = ?
    LIMIT 1`).bind(profile.deviceId).first<StoredDeviceAxleProfileRow>();
  if (!stored) throw new Error("階軸設定寫入後無法讀回。");
  return rowToDeviceAxleProfile(stored);
}
