import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadPredictionModule() {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "wear-prediction-"));
  const outputFile = path.join(outputDirectory, "wear-prediction.mjs");
  const source = await readFile(path.join(projectRoot, "app/lib/wearPrediction.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  await writeFile(outputFile, compiled.outputText, "utf8");
  const predictionModule = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`);
  return { predictionModule, cleanup: () => rm(outputDirectory, { recursive: true, force: true }) };
}

test("uses elapsed calendar days instead of treating sparse inspections as evenly spaced", async () => {
  const { predictionModule, cleanup } = await loadPredictionModule();
  try {
    const prediction = predictionModule.predictWearTrend([
      { date: "2026-01-01", wear: 1.0 },
      { date: "2026-01-11", wear: 1.1 },
      { date: "2026-02-10", wear: 1.4 },
    ], 2, 3);

    assert.ok(Math.abs(prediction.ratePerDay - 0.01) < 1e-10);
    assert.ok(Math.abs(prediction.projected90DayWear - 2.3) < 1e-10);
    assert.equal(prediction.management.state, "within-horizon");
    assert.equal(prediction.management.date, "2026-04-11");
  } finally {
    await cleanup();
  }
});

test("median pairwise slope resists a single abnormal measurement", async () => {
  const { predictionModule, cleanup } = await loadPredictionModule();
  try {
    const prediction = predictionModule.predictWearTrend([
      { date: "2026-01-01", wear: 1.0 },
      { date: "2026-01-11", wear: 1.1 },
      { date: "2026-01-21", wear: 3.0 },
      { date: "2026-01-31", wear: 1.3 },
      { date: "2026-02-10", wear: 1.4 },
    ], 2, 3);

    assert.ok(Math.abs(prediction.ratePerDay - 0.01) < 1e-10);
    assert.ok(prediction.projected90DayWear < 2.4);
  } finally {
    await cleanup();
  }
});

test("starts a new trend after a maintenance-sized wear reset", async () => {
  const { predictionModule, cleanup } = await loadPredictionModule();
  try {
    const prediction = predictionModule.predictWearTrend([
      { date: "2026-01-01", wear: 3.0 },
      { date: "2026-02-01", wear: 3.1 },
      { date: "2026-03-01", wear: 1.0 },
      { date: "2026-04-01", wear: 1.1 },
      { date: "2026-05-01", wear: 1.2 },
    ], 2, 3);

    assert.equal(prediction.resetDetected, true);
    assert.equal(prediction.sampleCount, 3);
    assert.equal(prediction.latestDate, "2026-05-01");
    assert.ok(prediction.ratePerDay > 0);
  } finally {
    await cleanup();
  }
});

test("marks long-range rail warning dates as outside the credible horizon", async () => {
  const { predictionModule, cleanup } = await loadPredictionModule();
  try {
    const prediction = predictionModule.predictWearTrend([
      { date: "2026-01-18", wear: 2.65 },
      { date: "2026-02-27", wear: 2.71 },
      { date: "2026-04-14", wear: 2.78 },
      { date: "2026-05-01", wear: 2.85 },
      { date: "2026-05-29", wear: 2.93 },
      { date: "2026-06-21", wear: 3.01 },
      { date: "2026-07-20", wear: 3.10 },
    ], 15.5, 17);

    assert.equal(prediction.confidence, "high");
    assert.equal(prediction.management.state, "beyond-horizon");
    assert.equal(prediction.maintenance.state, "beyond-horizon");
    assert.ok(prediction.ratePer30Days > 0.06 && prediction.ratePer30Days < 0.1);
  } finally {
    await cleanup();
  }
});
