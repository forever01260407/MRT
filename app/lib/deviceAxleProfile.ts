export type DeviceAxleProfile = {
  deviceId: string;
  effectiveDate: string;
  stageCount: number;
  axleCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DeviceAxleProfileInput = Pick<DeviceAxleProfile, "deviceId" | "effectiveDate" | "stageCount" | "axleCount">;

type StoredDeviceAxleProfileRow = {
  device_id: string;
  effective_date: string;
  stage_count: number;
  axle_count: number;
  created_at: string;
  updated_at: string;
};

export const DEVICE_AXLE_PROFILE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS device_axle_profiles (
  device_id TEXT PRIMARY KEY NOT NULL,
  effective_date TEXT NOT NULL,
  stage_count INTEGER NOT NULL CHECK (stage_count > 0),
  axle_count INTEGER NOT NULL CHECK (axle_count > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

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

export async function ensureDeviceAxleProfileTable(d1: D1Database) {
  await d1.prepare(DEVICE_AXLE_PROFILE_TABLE_SQL).run();
}

export async function listDeviceAxleProfiles(d1: D1Database) {
  const result = await d1.prepare(`SELECT device_id, effective_date, stage_count, axle_count, created_at, updated_at
    FROM device_axle_profiles
    ORDER BY device_id ASC`).all<StoredDeviceAxleProfileRow>();
  return result.results.map(rowToDeviceAxleProfile);
}

export async function upsertDeviceAxleProfile(d1: D1Database, profile: DeviceAxleProfileInput) {
  await d1.prepare(`INSERT INTO device_axle_profiles
    (device_id, effective_date, stage_count, axle_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      effective_date = excluded.effective_date,
      stage_count = excluded.stage_count,
      axle_count = excluded.axle_count,
      updated_at = CURRENT_TIMESTAMP`)
    .bind(profile.deviceId, profile.effectiveDate, profile.stageCount, profile.axleCount)
    .run();

  const stored = await d1.prepare(`SELECT device_id, effective_date, stage_count, axle_count, created_at, updated_at
    FROM device_axle_profiles
    WHERE device_id = ?
    LIMIT 1`).bind(profile.deviceId).first<StoredDeviceAxleProfileRow>();
  if (!stored) throw new Error("階軸設定寫入後無法讀回。");
  return rowToDeviceAxleProfile(stored);
}
