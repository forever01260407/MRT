const DAY_IN_MS = 86_400_000;

export type WearPredictionSample = {
  date: string;
  wear: number;
};

export type WearPredictionConfidence = "insufficient" | "low" | "medium" | "high";
export type WearThresholdState = "already-reached" | "within-horizon" | "beyond-horizon" | "not-predictable";

export type WearThresholdPrediction = {
  threshold: number;
  state: WearThresholdState;
  date: string | null;
  daysFromLatest: number | null;
};

export type WearPrediction = {
  method: "theil-sen-daily";
  sampleCount: number;
  observationSpanDays: number;
  latestDate: string;
  latestWear: number;
  ratePerDay: number;
  ratePer30Days: number;
  projected90DayDate: string;
  projected90DayWear: number;
  confidence: WearPredictionConfidence;
  resetDetected: boolean;
  reliableHorizonDays: number;
  reliableThroughDate: string;
  management: WearThresholdPrediction;
  maintenance: WearThresholdPrediction;
};

type NormalizedSample = WearPredictionSample & { timestamp: number };

function parseDateOnly(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return timestamp;
}

function formatDateOnly(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function addDays(timestamp: number, days: number) {
  return timestamp + days * DAY_IN_MS;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function normalizeSamples(samples: WearPredictionSample[]) {
  const byTimestamp = new Map<number, NormalizedSample>();
  for (const sample of samples) {
    const timestamp = parseDateOnly(sample.date);
    if (timestamp === null || !Number.isFinite(sample.wear) || sample.wear < 0) continue;
    byTimestamp.set(timestamp, { date: formatDateOnly(timestamp), wear: sample.wear, timestamp });
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function thresholdPrediction(latest: NormalizedSample, ratePerDay: number, reliableHorizonDays: number, threshold: number): WearThresholdPrediction {
  if (latest.wear >= threshold) {
    return { threshold, state: "already-reached", date: latest.date, daysFromLatest: 0 };
  }
  if (ratePerDay < 0.0001) {
    return { threshold, state: "not-predictable", date: null, daysFromLatest: null };
  }
  const daysFromLatest = Math.ceil((threshold - latest.wear) / ratePerDay - 1e-9);
  return {
    threshold,
    state: daysFromLatest <= reliableHorizonDays ? "within-horizon" : "beyond-horizon",
    date: formatDateOnly(addDays(latest.timestamp, daysFromLatest)),
    daysFromLatest,
  };
}

/**
 * Estimates sparse rail-wear growth using the median slope between every pair
 * of valid observations (Theil–Sen). Date-only values are converted to UTC
 * calendar days so browser timezone and clock settings cannot change the rate.
 */
export function predictWearTrend(
  samples: WearPredictionSample[],
  managementThreshold: number,
  maintenanceThreshold: number,
): WearPrediction {
  const normalized = normalizeSamples(samples);
  if (!normalized.length) throw new Error("At least one valid wear observation is required.");

  let resetIndex = 0;
  for (let index = 1; index < normalized.length; index += 1) {
    const drop = normalized[index - 1].wear - normalized[index].wear;
    const establishedBeforeDrop = index >= 2 && Math.abs(normalized[index - 1].wear - normalized[index - 2].wear) < 0.5;
    const confirmedAfterDrop = index === normalized.length - 1 || normalized[index + 1].wear <= normalized[index - 1].wear - 0.5;
    if (drop >= 0.5 && establishedBeforeDrop && confirmedAfterDrop) resetIndex = index;
  }
  const usable = normalized.slice(resetIndex);
  const latest = usable[usable.length - 1];
  const earliest = usable[0];
  const observationSpanDays = Math.max(0, Math.round((latest.timestamp - earliest.timestamp) / DAY_IN_MS));
  const slopes: number[] = [];
  for (let left = 0; left < usable.length - 1; left += 1) {
    for (let right = left + 1; right < usable.length; right += 1) {
      const elapsedDays = (usable[right].timestamp - usable[left].timestamp) / DAY_IN_MS;
      if (elapsedDays > 0) slopes.push((usable[right].wear - usable[left].wear) / elapsedDays);
    }
  }

  const rawRate = median(slopes);
  const ratePerDay = usable.length >= 3 && observationSpanDays >= 30 ? Math.max(0, rawRate) : 0;
  const absoluteDeviations = slopes.map((slope) => Math.abs(slope - rawRate));
  const relativeDispersion = Math.abs(rawRate) < 0.0001 ? Number.POSITIVE_INFINITY : median(absoluteDeviations) / Math.abs(rawRate);
  const confidence: WearPredictionConfidence = usable.length < 3 || observationSpanDays < 30
    ? "insufficient"
    : usable.length >= 6 && observationSpanDays >= 150 && relativeDispersion <= 0.35
      ? "high"
      : usable.length >= 4 && observationSpanDays >= 90 && relativeDispersion <= 0.75
        ? "medium"
        : "low";
  const reliableHorizonDays = Math.min(1_095, Math.max(180, Math.round(observationSpanDays * 3)));
  const projected90DayDate = formatDateOnly(addDays(latest.timestamp, 90));

  return {
    method: "theil-sen-daily",
    sampleCount: usable.length,
    observationSpanDays,
    latestDate: latest.date,
    latestWear: latest.wear,
    ratePerDay,
    ratePer30Days: ratePerDay * 30,
    projected90DayDate,
    projected90DayWear: latest.wear + ratePerDay * 90,
    confidence,
    resetDetected: resetIndex > 0,
    reliableHorizonDays,
    reliableThroughDate: formatDateOnly(addDays(latest.timestamp, reliableHorizonDays)),
    management: thresholdPrediction(latest, ratePerDay, reliableHorizonDays, managementThreshold),
    maintenance: thresholdPrediction(latest, ratePerDay, reliableHorizonDays, maintenanceThreshold),
  };
}
