import type { LubricationRecord } from "./lubricationExcel";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_REFILL_THRESHOLD = 1;

export type ConsumptionSegment = {
  startDate: string;
  endDate: string;
  startLevel: number;
  endLevel: number;
  days: number;
  consumption: number;
  dailyRate: number;
  weight: number;
};

export type ConsumptionBaselineOptions = {
  /** A rise must be strictly greater than this value to infer a refill. */
  refillThreshold?: number;
};

export type ConsumptionBaselineResult = {
  segments: ConsumptionSegment[];
  dailyConsumptionBaseline: number | null;
  totalCommittedConsumption: number;
  totalCommittedDays: number;
  provisionalSegment: ConsumptionSegment | null;
  provisionalRate: number | null;
  latestRecord: LubricationRecord | null;
  sourceRecordCount: number;
};

export type ForecastOptions = {
  clampAtZero?: boolean;
};

function roundForCalculation(value: number) {
  return Number(value.toFixed(6));
}

function timestampOf(record: LubricationRecord) {
  return Date.parse(record.measuredAt);
}

function elapsedDays(start: LubricationRecord, end: LubricationRecord) {
  const startTime = timestampOf(start);
  const endTime = timestampOf(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;
  return (endTime - startTime) / MILLISECONDS_PER_DAY;
}

function toSegment(
  start: LubricationRecord,
  end: LubricationRecord,
): ConsumptionSegment | null {
  const days = elapsedDays(start, end);
  const consumption = start.oilLevel - end.oilLevel;

  if (days <= 0 || consumption <= 0) return null;

  const normalizedDays = roundForCalculation(days);
  const normalizedConsumption = roundForCalculation(consumption);

  return {
    startDate: start.measuredAt,
    endDate: end.measuredAt,
    startLevel: start.oilLevel,
    endLevel: end.oilLevel,
    days: normalizedDays,
    consumption: normalizedConsumption,
    dailyRate: roundForCalculation(normalizedConsumption / normalizedDays),
    weight: normalizedDays,
  };
}

function sortRecordsByMeasurementTime(records: LubricationRecord[]) {
  return [...records].sort((a, b) => {
    const aTime = timestampOf(a);
    const bTime = timestampOf(b);

    if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime;
    if (Number.isFinite(aTime)) return -1;
    if (Number.isFinite(bTime)) return 1;
    return a.measuredAt.localeCompare(b.measuredAt);
  });
}

/**
 * Calculates a baseline for one device. The input is copied before sorting and
 * is never mutated. Only segments closed by a refill boundary are committed;
 * the final open segment is returned separately as provisional data.
 */
export function calculateConsumptionBaseline(
  records: LubricationRecord[],
  options: ConsumptionBaselineOptions = {},
): ConsumptionBaselineResult {
  const thresholdCandidate = options.refillThreshold ?? DEFAULT_REFILL_THRESHOLD;
  const refillThreshold = Number.isFinite(thresholdCandidate) && thresholdCandidate >= 0
    ? thresholdCandidate
    : DEFAULT_REFILL_THRESHOLD;
  const sortedRecords = sortRecordsByMeasurementTime(records);

  if (!sortedRecords.length) {
    return {
      segments: [],
      dailyConsumptionBaseline: null,
      totalCommittedConsumption: 0,
      totalCommittedDays: 0,
      provisionalSegment: null,
      provisionalRate: null,
      latestRecord: null,
      sourceRecordCount: 0,
    };
  }

  const segments: ConsumptionSegment[] = [];
  let segmentStart = sortedRecords[0];

  for (let index = 1; index < sortedRecords.length; index += 1) {
    const previous = sortedRecords[index - 1];
    const current = sortedRecords[index];
    const isExplicitRefill = current.recordType === "補油";
    const isInferredRefill = current.oilLevel - previous.oilLevel > refillThreshold;

    if (!isExplicitRefill && !isInferredRefill) continue;

    const completedSegment = toSegment(segmentStart, previous);
    if (completedSegment) segments.push(completedSegment);
    segmentStart = current;
  }

  const latestRecord = sortedRecords[sortedRecords.length - 1];
  const provisionalSegment = toSegment(segmentStart, latestRecord);
  const totalCommittedConsumption = roundForCalculation(
    segments.reduce((sum, segment) => sum + segment.consumption, 0),
  );
  const totalCommittedDays = roundForCalculation(
    segments.reduce((sum, segment) => sum + segment.days, 0),
  );
  const dailyConsumptionBaseline = totalCommittedDays > 0
    ? roundForCalculation(totalCommittedConsumption / totalCommittedDays)
    : null;

  return {
    segments,
    dailyConsumptionBaseline,
    totalCommittedConsumption,
    totalCommittedDays,
    provisionalSegment,
    provisionalRate: provisionalSegment?.dailyRate ?? null,
    latestRecord,
    sourceRecordCount: sortedRecords.length,
  };
}

/** Predicts the remaining level after `daysAhead` using a committed baseline. */
export function forecastOilLevel(
  currentLevel: number,
  dailyConsumptionBaseline: number | null,
  daysAhead: number,
  options: ForecastOptions = {},
) {
  if (
    dailyConsumptionBaseline === null
    || !Number.isFinite(currentLevel)
    || !Number.isFinite(dailyConsumptionBaseline)
    || !Number.isFinite(daysAhead)
    || currentLevel < 0
    || dailyConsumptionBaseline < 0
    || daysAhead < 0
  ) {
    return null;
  }

  const expectedLevel = currentLevel - dailyConsumptionBaseline * daysAhead;
  const shouldClampAtZero = options.clampAtZero ?? true;
  return roundForCalculation(shouldClampAtZero ? Math.max(0, expectedLevel) : expectedLevel);
}
