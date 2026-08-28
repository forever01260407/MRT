import { getD1 } from "../../../db";
import {
  authorizeDeviceAxleProfileWrite,
  DeviceAxleProfileAuthorizationError,
  getDeviceAxleProfileAuthorizationRuntimeEnv,
} from "../../lib/deviceAxleProfileAuthorization";
import {
  ensureDeviceAxleProfileTable,
  listDeviceAxleProfiles,
  upsertDeviceAxleProfile,
} from "../../lib/deviceAxleProfile";

class DeviceAxleProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceAxleProfileValidationError";
  }
}

function normalizeDeviceId(value: unknown) {
  const compact = String(value ?? "").trim().toUpperCase().replace(/[\s_-]/g, "");
  const match = compact.match(/^(MOK|LB)(\d{1,2})$/);
  const number = Number(match?.[2]);
  if (!match || !Number.isInteger(number) || number < 1 || number > 10) return null;
  return `${match[1]}${number}`;
}

function normalizeEffectiveDate(value: unknown) {
  const dateText = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) return null;
  return dateText;
}

function normalizePositiveInteger(value: unknown, label: string, maximum: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new DeviceAxleProfileValidationError(`${label}必須是 1～${maximum} 的整數。`);
  }
  return number;
}

function parsePayload(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new DeviceAxleProfileValidationError("階軸設定不是有效資料。");
  }
  const raw = value as Record<string, unknown>;
  const deviceId = normalizeDeviceId(raw.deviceId);
  const effectiveDate = normalizeEffectiveDate(raw.effectiveDate);
  const password = String(raw.password ?? "").trim();
  if (!deviceId) throw new DeviceAxleProfileValidationError("潤滑站點必須是 MOK-01～MOK-10 或 LB-01～LB-10。");
  if (!effectiveDate) throw new DeviceAxleProfileValidationError("請輸入有效的更新日期。");
  if (!password) throw new DeviceAxleProfileValidationError("請輸入管理密碼。");
  return {
    password,
    profile: {
      deviceId,
      effectiveDate,
      stageCount: normalizePositiveInteger(raw.stageCount, "階數", 99),
      axleCount: normalizePositiveInteger(raw.axleCount, "軸數", 999),
    },
  };
}

export async function GET() {
  try {
    const d1 = await getD1();
    await ensureDeviceAxleProfileTable(d1);
    const deviceAxleProfiles = await listDeviceAxleProfiles(d1);
    return Response.json({ deviceAxleProfiles, count: deviceAxleProfiles.length });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "無法讀取階軸設定。" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const payload = parsePayload(await request.json());
    await authorizeDeviceAxleProfileWrite({
      request,
      runtimeEnv: await getDeviceAxleProfileAuthorizationRuntimeEnv(),
      password: payload.password,
    });

    const d1 = await getD1();
    await ensureDeviceAxleProfileTable(d1);
    const existing = await d1.prepare("SELECT device_id FROM device_axle_profiles WHERE device_id = ? LIMIT 1")
      .bind(payload.profile.deviceId)
      .first<{ device_id: string }>();
    const profile = await upsertDeviceAxleProfile(d1, payload.profile);
    const deviceAxleProfiles = await listDeviceAxleProfiles(d1);
    return Response.json({
      profile,
      deviceAxleProfiles,
      overwritten: Boolean(existing),
      message: existing ? `${profile.deviceId} 的階軸設定已覆蓋。` : `${profile.deviceId} 的階軸設定已建立。`,
    }, { status: existing ? 200 : 201 });
  } catch (error) {
    if (error instanceof DeviceAxleProfileAuthorizationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof DeviceAxleProfileValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "階軸設定無法寫入永久資料庫。" },
      { status: 500 },
    );
  }
}
