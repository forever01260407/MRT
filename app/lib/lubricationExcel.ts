import { readSheet } from "read-excel-file/browser";

export type LubricationRecordType = "量測" | "補油";

export type LubricationRecord = {
  deviceId: string;
  measuredAt: string;
  oilLevel: number;
  inspector: string;
  recordType: LubricationRecordType;
  refillAmount: number | null;
};

const expectedHeaders = ["設備編號", "量測時間", "油量（L）", "檢修人員", "紀錄類型", "補油量（L）"] as const;

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）");
}

function normalizeDeviceId(value: unknown) {
  const compact = String(value ?? "").trim().toUpperCase().replace(/[\s_-]/g, "");
  const match = compact.match(/^(MOK|LB)(\d{1,2})$/);
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isInteger(number) || number < 1 || number > 10) return null;
  return `${match[1]}${number}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function validDateParts(year: number, month: number, day: number, hour: number, minute: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
    && candidate.getUTCHours() === hour
    && candidate.getUTCMinutes() === minute;
}

function normalizeMeasurementTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}T${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:00`;
  }

  const text = String(value ?? "").trim().replace(/[/.]/g, "-");
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?$/);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText = "0", minuteText = "0"] = match;
  const [year, month, day, hour, minute] = [yearText, monthText, dayText, hourText, minuteText].map(Number);
  if (!validDateParts(year, month, day, hour, minute)) return null;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export class LubricationImportError extends Error {
  constructor(public readonly details: string[]) {
    super(details[0] ?? "Excel 內容無法匯入。");
    this.name = "LubricationImportError";
  }
}

export function parseLubricationRows(rows: unknown[][]): LubricationRecord[] {
  const nonEmptyRows = rows.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
  if (!nonEmptyRows.length) throw new LubricationImportError(["Excel 第一張工作表沒有資料。"]);

  const normalizedHeaders = nonEmptyRows[0].map(normalizeHeader);
  const headerIndexes = Object.fromEntries(expectedHeaders.map((header) => [header, normalizedHeaders.indexOf(header)])) as Record<(typeof expectedHeaders)[number], number>;
  const missingHeaders = expectedHeaders.filter((header) => headerIndexes[header] < 0);
  if (missingHeaders.length) {
    throw new LubricationImportError([`缺少必要欄位：${missingHeaders.join("、")}。請使用網站提供的 Excel 範本。`]);
  }

  const errors: string[] = [];
  const records: LubricationRecord[] = [];
  const uniqueKeys = new Set<string>();

  nonEmptyRows.slice(1).forEach((row, dataIndex) => {
    const rowNumber = dataIndex + 2;
    const deviceId = normalizeDeviceId(row[headerIndexes["設備編號"]]);
    const measuredAt = normalizeMeasurementTime(row[headerIndexes["量測時間"]]);
    const oilLevel = normalizeNumber(row[headerIndexes["油量（L）"]]);
    const inspector = String(row[headerIndexes["檢修人員"]] ?? "").trim();
    const recordTypeText = String(row[headerIndexes["紀錄類型"]] ?? "").trim();
    const refillAmount = normalizeNumber(row[headerIndexes["補油量（L）"]]);

    if (!deviceId) errors.push(`第 ${rowNumber} 列：設備編號必須是 MOK-01～MOK-10 或 LB-01～LB-10。`);
    if (!measuredAt) errors.push(`第 ${rowNumber} 列：量測時間格式錯誤，請使用 yyyy-mm-dd hh:mm。`);
    if (oilLevel === null || oilLevel < 0) errors.push(`第 ${rowNumber} 列：油量必須是大於或等於 0 的數字。`);
    if (!inspector) errors.push(`第 ${rowNumber} 列：檢修人員不可空白。`);
    if (recordTypeText !== "量測" && recordTypeText !== "補油") errors.push(`第 ${rowNumber} 列：紀錄類型只能是「量測」或「補油」。`);
    if (recordTypeText === "補油" && (refillAmount === null || refillAmount <= 0)) errors.push(`第 ${rowNumber} 列：補油紀錄必須填寫大於 0 的補油量。`);
    if (recordTypeText === "量測" && refillAmount !== null && refillAmount !== 0) errors.push(`第 ${rowNumber} 列：量測紀錄的補油量應保持空白。`);

    if (!deviceId || !measuredAt || oilLevel === null || oilLevel < 0 || !inspector || (recordTypeText !== "量測" && recordTypeText !== "補油")) return;

    const uniqueKey = `${deviceId}|${measuredAt}`;
    if (uniqueKeys.has(uniqueKey)) {
      errors.push(`第 ${rowNumber} 列：${deviceId} 在 ${measuredAt.replace("T", " ").slice(0, 16)} 已有重複紀錄。`);
      return;
    }
    uniqueKeys.add(uniqueKey);
    records.push({
      deviceId,
      measuredAt,
      oilLevel: Number(oilLevel.toFixed(2)),
      inspector,
      recordType: recordTypeText,
      refillAmount: recordTypeText === "補油" && refillAmount !== null ? Number(refillAmount.toFixed(2)) : null,
    });
  });

  if (errors.length) throw new LubricationImportError(errors.slice(0, 12));
  if (!records.length) throw new LubricationImportError(["Excel 沒有可匯入的潤滑紀錄。"]);

  return records.sort((a, b) => a.deviceId.localeCompare(b.deviceId) || a.measuredAt.localeCompare(b.measuredAt));
}

export async function readLubricationWorkbook(file: File) {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new LubricationImportError(["目前只支援 .xlsx 檔案，請下載網站提供的範本填寫。"]);
  }
  const rows = await readSheet(file);
  return parseLubricationRows(rows as unknown[][]);
}
