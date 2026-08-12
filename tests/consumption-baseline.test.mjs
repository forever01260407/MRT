import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadBaselineModule() {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "consumption-baseline-"));
  const outputFile = path.join(outputDirectory, "baseline.mjs");
  const source = await readFile(path.join(projectRoot, "app/lib/consumptionBaseline.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  await writeFile(outputFile, compiled.outputText, "utf8");
  const module = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`);
  return { module, cleanup: () => rm(outputDirectory, { recursive: true, force: true }) };
}

function record(measuredAt, oilLevel, recordType = "量測") {
  return {
    deviceId: "MOK3",
    measuredAt: `${measuredAt}T08:00:00`,
    oilLevel,
    inspector: "test",
    recordType,
    refillAmount: recordType === "補油" ? 1 : null,
  };
}

test("continuous declines form weighted committed segments while the tail stays provisional", async () => {
  const { module, cleanup } = await loadBaselineModule();
  try {
    const result = module.calculateConsumptionBaseline([
      record("2026-07-01", 70),
      record("2026-07-02", 68),
      record("2026-07-04", 64.3),
      record("2026-07-06", 60.1),
      record("2026-07-08", 76, "補油"),
      record("2026-07-09", 73.9),
      record("2026-07-10", 72),
      record("2026-07-11", 70.1),
      record("2026-07-12", 80, "補油"),
      record("2026-07-13", 78.1),
    ]);

    assert.equal(result.segments.length, 2);
    assert.deepEqual(
      result.segments.map(({ days, consumption, dailyRate, weight }) => ({ days, consumption, dailyRate, weight })),
      [
        { days: 5, consumption: 9.9, dailyRate: 1.98, weight: 5 },
        { days: 3, consumption: 5.9, dailyRate: 1.966667, weight: 3 },
      ],
    );
    assert.equal(result.dailyConsumptionBaseline, 1.975);
    assert.equal(result.provisionalRate, 1.9);
    assert.equal(module.forecastOilLevel(72.3, result.dailyConsumptionBaseline, 2), 68.35);
  } finally {
    await cleanup();
  }
});

test("an explicit refill wins and an inferred rise must be strictly above the threshold", async () => {
  const { module, cleanup } = await loadBaselineModule();
  try {
    const exactThreshold = module.calculateConsumptionBaseline([
      record("2026-07-01", 70),
      record("2026-07-02", 68),
      record("2026-07-03", 69),
      record("2026-07-04", 67),
    ]);
    assert.equal(exactThreshold.segments.length, 0);
    assert.equal(exactThreshold.provisionalSegment?.consumption, 3);

    const explicitRefill = module.calculateConsumptionBaseline([
      record("2026-07-01", 70),
      record("2026-07-02", 68),
      record("2026-07-03", 68.1, "補油"),
      record("2026-07-04", 67),
    ]);
    assert.equal(explicitRefill.segments.length, 1);
    assert.equal(explicitRefill.segments[0].endDate, "2026-07-02T08:00:00");
  } finally {
    await cleanup();
  }
});
