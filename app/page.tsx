"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { calculateConsumptionBaseline, forecastOilLevel } from "./lib/consumptionBaseline";
import { LubricationImportError, readLubricationWorkbook } from "./lib/lubricationExcel";
import type { LubricationRecord } from "./lib/lubricationExcel";

type RailStatus = "normal" | "warning" | "critical" | "unknown";
type Direction = "up" | "down";
type LabelSide = "right" | "left" | "top" | "bottom" | "upper-left" | "upper-right" | "lower-left" | "lower-right" | "corner";

type Station = {
  id: string;
  name: string;
};

type Device = {
  id: string;
  direction: Direction;
  status: RailStatus;
  value: number;
  change: number;
  history: number[];
  historyDates: string[];
  records?: LubricationRecord[];
  latestRecord?: LubricationRecord;
  dataState?: "imported" | "missing";
};

type Segment = {
  id: string;
  from: number;
  to: number;
  location: string;
  fallbackUp: RailStatus;
  fallbackDown: RailStatus;
  devices: Device[];
};

type Point = {
  x: number;
  y: number;
  labelSide: LabelSide;
};

type SegmentGeometry = {
  x: number;
  y: number;
  length: number;
  angle: number;
};

type RouteLayout = {
  stationPoints: Record<string, Point>;
  segmentGeometry: Record<string, SegmentGeometry>;
  bendStation: string;
  unit: number;
  totalWeight: number;
};

type ExcelImportState = {
  status: "idle" | "loading" | "preview" | "saving" | "success" | "error";
  message: string;
  fileName?: string;
  recordCount?: number;
  deviceCount?: number;
  duplicateCount?: number;
  insertedCount?: number;
  latestMeasuredAt?: string;
  errors?: string[];
};

type PendingImport = {
  fileName: string;
  fileHash: string;
  records: LubricationRecord[];
  duplicateCount: number;
};

type ManualEntryForm = {
  deviceId: string;
  oilLevel: string;
  measuredDate: string;
  inspector: string;
  recordType: LubricationRecord["recordType"];
  refillAmount: string;
};

type ManualEntryFeedback = {
  status: "idle" | "saving" | "success" | "error";
  message: string;
};

const stations: Station[] = [
  { id: "Y6", name: "大坪林" },
  { id: "Y7", name: "十四張" },
  { id: "Y8", name: "秀朗橋" },
  { id: "Y9", name: "景平" },
  { id: "Y10", name: "景安" },
  { id: "Y11", name: "中和" },
  { id: "Y12", name: "橋和" },
  { id: "Y13", name: "中原" },
  { id: "Y14", name: "板新" },
  { id: "Y15", name: "板橋" },
  { id: "Y16", name: "新埔民生" },
  { id: "Y17", name: "頭前庄" },
  { id: "Y18", name: "幸福" },
  { id: "Y19", name: "新北產業園區" },
];

const demoHistoryDates = [
  "2026-07-18T08:00:00",
  "2026-07-19T08:00:00",
  "2026-07-20T08:00:00",
  "2026-07-21T08:00:00",
  "2026-07-22T08:00:00",
  "2026-07-23T08:00:00",
  "2026-07-24T08:00:00",
];

const mok3DemoHistoryDates = [
  "2026-07-01T08:00:00",
  "2026-07-02T08:00:00",
  "2026-07-04T08:00:00",
  "2026-07-06T08:00:00",
  "2026-07-08T08:00:00",
  "2026-07-09T08:00:00",
  "2026-07-10T08:00:00",
  "2026-07-11T08:00:00",
  "2026-07-12T08:00:00",
  "2026-07-13T08:00:00",
  "2026-07-14T08:00:00",
  "2026-07-17T08:00:00",
  "2026-07-18T08:00:00",
  "2026-07-19T08:00:00",
  "2026-07-20T08:00:00",
  "2026-07-22T08:00:00",
  "2026-07-23T08:00:00",
];

const mok3DemoHistory = [
  70, 68, 64.3, 60.1,
  76, 73.9, 72, 70.1,
  80, 78.1, 76, 70.2, 68.4,
  80, 78.1, 74.2, 72.3,
];

function makeDevice(
  id: string,
  direction: Direction,
  status: RailStatus,
  value: number,
  change: number,
  history: number[],
  historyDates: string[] = demoHistoryDates,
  refillIndexes: number[] = [],
): Device {
  const records: LubricationRecord[] = history.map((oilLevel, index) => {
    const isRefill = refillIndexes.includes(index);
    const previousLevel = history[index - 1];
    return {
      deviceId: id,
      measuredAt: historyDates[index],
      oilLevel,
      inspector: "示範資料",
      recordType: isRefill ? "補油" : "量測",
      refillAmount: isRefill && previousLevel !== undefined
        ? Number(Math.max(0, oilLevel - previousLevel).toFixed(2))
        : null,
    };
  });

  return { id, direction, status, value, change, history, historyDates, records };
}

function hasDeviceData(device: Device) {
  return device.dataState !== "missing";
}

const segments: Segment[] = [
  { id: "Y6-Y7", from: 0, to: 1, location: "大坪林－十四張", fallbackUp: "unknown", fallbackDown: "unknown", devices: [] },
  {
    id: "Y7-Y8", from: 1, to: 2, location: "十四張－秀朗橋", fallbackUp: "unknown", fallbackDown: "unknown",
    devices: [
      makeDevice("MOK1", "up", "warning", 19, -2, [57, 52, 45, 37, 31, 25, 19]),
      makeDevice("LB1", "down", "normal", 51, 1, [44, 45, 47, 49, 50, 50, 51]),
    ],
  },
  { id: "Y8-Y9", from: 2, to: 3, location: "秀朗橋－景平", fallbackUp: "normal", fallbackDown: "normal", devices: [] },
  { id: "Y9-Y10", from: 3, to: 4, location: "景平－景安", fallbackUp: "normal", fallbackDown: "normal", devices: [] },
  {
    id: "Y10-Y11", from: 4, to: 5, location: "景安－中和", fallbackUp: "unknown", fallbackDown: "unknown",
    devices: [
      makeDevice("MOK2", "up", "normal", 51, -1, [63, 61, 59, 58, 56, 52, 51]),
      makeDevice("MOK3", "up", "normal", 72.3, -1.9, mok3DemoHistory, mok3DemoHistoryDates, [4, 8, 13]),
      makeDevice("MOK4", "up", "critical", 18, -3, [54, 49, 43, 36, 29, 21, 18]),
      makeDevice("MOK5", "up", "critical", 17, 0, [68, 59, 52, 43, 35, 27, 17]),
      makeDevice("LB2", "down", "normal", 58, 2, [49, 50, 52, 53, 55, 56, 58]),
      makeDevice("LB3", "down", "critical", 16, -4, [52, 47, 41, 35, 29, 20, 16]),
      makeDevice("LB4", "down", "critical", 12, -5, [48, 44, 39, 31, 24, 17, 12]),
      makeDevice("LB5", "down", "critical", 9, -3, [45, 41, 35, 29, 22, 12, 9]),
    ],
  },
  {
    id: "Y11-Y12", from: 5, to: 6, location: "中和－橋和", fallbackUp: "unknown", fallbackDown: "unknown",
    devices: [
      makeDevice("MOK6", "up", "normal", 63, 1, [58, 59, 60, 60, 61, 62, 63]),
      makeDevice("LB6", "down", "normal", 49, -1, [72, 68, 65, 61, 58, 54, 49]),
    ],
  },
  { id: "Y12-Y13", from: 6, to: 7, location: "橋和－中原", fallbackUp: "unknown", fallbackDown: "unknown", devices: [] },
  { id: "Y13-Y14", from: 7, to: 8, location: "中原－板新", fallbackUp: "normal", fallbackDown: "normal", devices: [] },
  {
    id: "Y14-Y15", from: 8, to: 9, location: "板新－板橋", fallbackUp: "unknown", fallbackDown: "unknown",
    devices: [
      makeDevice("MOK7", "up", "normal", 34, -2, [48, 46, 44, 41, 39, 36, 34]),
      makeDevice("MOK8", "up", "critical", 15, -6, [55, 49, 42, 35, 29, 21, 15]),
      makeDevice("LB7", "down", "critical", 6, -5, [53, 47, 42, 34, 27, 18, 6]),
      makeDevice("LB8", "down", "warning", 21, -2, [44, 40, 37, 33, 29, 23, 21]),
    ],
  },
  {
    id: "Y15-Y16", from: 9, to: 10, location: "板橋－新埔民生", fallbackUp: "unknown", fallbackDown: "unknown",
    devices: [
      makeDevice("MOK9", "up", "normal", 67, 1, [60, 61, 62, 63, 65, 66, 67]),
      makeDevice("MOK10", "up", "normal", 72, 0, [69, 70, 70, 71, 71, 72, 72]),
      makeDevice("LB9", "down", "normal", 45, -1, [53, 52, 50, 49, 48, 46, 45]),
      makeDevice("LB10", "down", "warning", 24, -3, [46, 43, 39, 35, 31, 27, 24]),
    ],
  },
  { id: "Y16-Y17", from: 10, to: 11, location: "新埔民生－頭前庄", fallbackUp: "unknown", fallbackDown: "unknown", devices: [] },
  { id: "Y17-Y18", from: 11, to: 12, location: "頭前庄－幸福", fallbackUp: "normal", fallbackDown: "normal", devices: [] },
  { id: "Y18-Y19", from: 12, to: 13, location: "幸福－新北產業園區", fallbackUp: "unknown", fallbackDown: "unknown", devices: [] },
];

const statusText: Record<RailStatus, string> = {
  normal: "正常",
  warning: "注意",
  critical: "需處理",
  unknown: "尚無資料",
};

const statusPriority: Record<RailStatus, number> = {
  unknown: 0,
  normal: 1,
  warning: 2,
  critical: 3,
};

const routeStations = [...stations].reverse();
const routeSegments = [...segments].reverse();
const stationLabelSides: Record<string, LabelSide> = {
  Y19: "right",
  Y18: "right",
  Y17: "upper-left",
  Y16: "lower-left",
  Y15: "upper-right",
  Y14: "lower-left",
  Y13: "upper-right",
  Y12: "lower-left",
  Y11: "upper-left",
  Y10: "lower-right",
  Y9: "top",
  Y8: "bottom",
  Y7: "top",
  Y6: "bottom",
};

function devicesByDirection(segment: Segment, direction: Direction) {
  return segment.devices.filter((device) => device.direction === direction);
}

function worstStatus(statuses: RailStatus[], fallback: RailStatus = "unknown") {
  return statuses.reduce<RailStatus>((worst, status) => (
    statusPriority[status] > statusPriority[worst] ? status : worst
  ), fallback);
}

function directionStatus(segment: Segment, direction: Direction) {
  const devices = devicesByDirection(segment, direction);
  const fallback = direction === "up" ? segment.fallbackUp : segment.fallbackDown;
  return devices.length ? worstStatus(devices.map((device) => device.status)) : fallback;
}

function segmentStatus(segment: Segment) {
  return worstStatus([directionStatus(segment, "up"), directionStatus(segment, "down")]);
}

function segmentSlotCount(segment: Segment) {
  return Math.max(devicesByDirection(segment, "up").length, devicesByDirection(segment, "down").length);
}

function segmentWeight(segment: Segment) {
  return 1 + 0.75 * segmentSlotCount(segment);
}

function stationStatus(stationIndex: number, sourceSegments: Segment[] = segments) {
  const adjacent = sourceSegments.filter((segment) => segment.from === stationIndex || segment.to === stationIndex);
  return worstStatus(adjacent.map(segmentStatus));
}

function formatChange(change: number) {
  if (change === 0) return "無變動";
  return `${change > 0 ? "+" : ""}${change} L`;
}

function oilLevelStatus(value: number): RailStatus {
  if (value < 20) return "critical";
  if (value < 30) return "warning";
  return "normal";
}

function formatMeasurementTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric" }).format(date);
}

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatChartDate(value: string) {
  const compact = value.replace("T", " ");
  return compact.slice(5, 10).replace("-", "/") + (compact.slice(11, 16) === "00:00" ? "" : ` ${compact.slice(11, 16)}`);
}

function formatBaselineDate(value: string) {
  return value.slice(5, 10).replace("-", "/");
}

function formatBaselineDays(days: number) {
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

function todayInTaipei() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function calendarDaysBetween(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${endDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function baselineRecordsForDevice(device: Device | null) {
  if (!device) return [];
  if (device.records) return device.records;
  return device.history.map<LubricationRecord>((oilLevel, index) => ({
    deviceId: device.id,
    measuredAt: device.historyDates[index],
    oilLevel,
    inspector: "歷史資料",
    recordType: "量測",
    refillAmount: null,
  })).filter((record) => Boolean(record.measuredAt));
}

function applyImportedRecords(sourceSegments: Segment[], records: LubricationRecord[]) {
  const recordsByDevice = new Map<string, LubricationRecord[]>();
  records.forEach((record) => {
    const deviceRecords = recordsByDevice.get(record.deviceId) ?? [];
    deviceRecords.push(record);
    recordsByDevice.set(record.deviceId, deviceRecords);
  });

  return sourceSegments.map((segment) => ({
    ...segment,
    fallbackUp: "unknown" as RailStatus,
    fallbackDown: "unknown" as RailStatus,
    devices: segment.devices.map((device) => {
      const deviceRecords = recordsByDevice.get(device.id);
      if (!deviceRecords?.length) {
        return {
          ...device,
          status: "unknown" as RailStatus,
          value: 0,
          change: 0,
          history: [],
          historyDates: [],
          records: [],
          latestRecord: undefined,
          dataState: "missing" as const,
        };
      }
      const sortedRecords = [...deviceRecords].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
      const latestRecord = sortedRecords[sortedRecords.length - 1];
      const previousRecord = sortedRecords[sortedRecords.length - 2];
      const change = previousRecord ? Number((latestRecord.oilLevel - previousRecord.oilLevel).toFixed(2)) : 0;
      return {
        ...device,
        status: oilLevelStatus(latestRecord.oilLevel),
        value: latestRecord.oilLevel,
        change,
        history: sortedRecords.map((record) => record.oilLevel),
        historyDates: sortedRecords.map((record) => record.measuredAt),
        records: sortedRecords,
        latestRecord,
        dataState: "imported" as const,
      };
    }),
  }));
}

function calculateRouteLayout(width: number, height: number): RouteLayout {
  const safeWidth = Math.max(width, 760);
  const safeHeight = Math.max(height, 560);
  const padding = { left: 124, right: 146, top: 72, bottom: 116 };
  const verticalAvailable = Math.max(300, safeHeight - padding.top - padding.bottom);
  const horizontalAvailable = Math.max(420, safeWidth - padding.left - padding.right);
  const weights = routeSegments.map(segmentWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const verticalSegmentCount = 2;
  const diagonalEndIndex = 9;
  const verticalWeight = weights.slice(0, verticalSegmentCount).reduce((sum, weight) => sum + weight, 0);
  const diagonalWeight = weights.slice(verticalSegmentCount, diagonalEndIndex).reduce((sum, weight) => sum + weight, 0);
  const horizontalWeight = weights.slice(diagonalEndIndex).reduce((sum, weight) => sum + weight, 0);
  let bestAngle = 34;
  let bestUnit = 0;

  for (let angle = 24; angle <= 48; angle += 0.5) {
    const radians = angle * Math.PI / 180;
    const widthWeight = diagonalWeight * Math.cos(radians) + horizontalWeight;
    const heightWeight = verticalWeight + diagonalWeight * Math.sin(radians);
    const candidateUnit = Math.min(
      horizontalAvailable / widthWeight,
      verticalAvailable / heightWeight,
    );
    if (candidateUnit > bestUnit) {
      bestUnit = candidateUnit;
      bestAngle = angle;
    }
  }

  const diagonalRadians = bestAngle * Math.PI / 180;
  const routeWidth = (diagonalWeight * Math.cos(diagonalRadians) + horizontalWeight) * bestUnit;
  const routeHeight = (verticalWeight + diagonalWeight * Math.sin(diagonalRadians)) * bestUnit;
  const startX = padding.left + Math.max(0, (horizontalAvailable - routeWidth) / 2);
  const startY = padding.top + Math.max(0, (verticalAvailable - routeHeight) / 2);

  const stationPoints: Record<string, Point> = {};
  const segmentGeometry: Record<string, SegmentGeometry> = {};
  let x = startX;
  let y = startY;

  stationPoints[routeStations[0].id] = { x, y, labelSide: stationLabelSides[routeStations[0].id] };

  routeSegments.forEach((segment, index) => {
    const length = weights[index] * bestUnit;
    const isVertical = index < verticalSegmentCount;
    const isDiagonal = index >= verticalSegmentCount && index < diagonalEndIndex;
    const angle = isVertical ? 90 : isDiagonal ? bestAngle : 0;
    const radians = angle * Math.PI / 180;
    segmentGeometry[segment.id] = { x, y, length, angle };

    x += length * Math.cos(radians);
    y += length * Math.sin(radians);

    const nextStation = routeStations[index + 1];
    stationPoints[nextStation.id] = { x, y, labelSide: stationLabelSides[nextStation.id] };
  });

  return {
    stationPoints,
    segmentGeometry,
    bendStation: `${routeStations[verticalSegmentCount].id}、${routeStations[diagonalEndIndex].id}`,
    unit: bestUnit,
    totalWeight,
  };
}

const comparisonColors = ["#6255df", "#0fa878", "#e8a321", "#ed4767", "#3288e8", "#9b62d9", "#00a6a6", "#d06b9f"];

function HistoryChart({ devices, expanded = false }: { devices: Device[]; expanded?: boolean }) {
  const chartRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let chart: { dispose: () => void; resize: () => void } | undefined;
    const axisDates = Array.from(new Set(devices.flatMap((device) => device.historyDates))).sort();
    const initialStartIndex = Math.max(0, axisDates.length - 7);
    const initialStartValue = axisDates[initialStartIndex];
    const initialEndValue = axisDates.at(-1);
    const highestValue = Math.max(80, ...devices.flatMap((device) => device.history));
    const yAxisMaximum = highestValue <= 100 ? Math.ceil(highestValue / 20) * 20 : Math.ceil(highestValue / 100) * 100;

    void import("echarts").then((echarts) => {
      if (disposed || !chartRoot.current) return;
      const styles = getComputedStyle(document.documentElement);
      const instance = echarts.init(chartRoot.current);
      chart = instance;
      instance.setOption({
        animationDuration: 420,
        color: comparisonColors,
        legend: {
          top: expanded ? 8 : 2,
          left: 0,
          itemWidth: expanded ? 28 : 18,
          itemHeight: expanded ? 12 : 8,
          textStyle: { color: styles.getPropertyValue("--ink-soft").trim(), fontSize: expanded ? 13 : 10 },
          data: devices.map((device) => device.id),
        },
        grid: {
          left: expanded ? 66 : 43,
          right: expanded ? 30 : 12,
          top: devices.length > 1 ? (expanded ? 66 : 48) : (expanded ? 52 : 36),
          bottom: expanded ? 86 : 66,
        },
        dataZoom: axisDates.length > 1 ? [
          {
            type: "inside",
            xAxisIndex: 0,
            startValue: initialStartValue,
            endValue: initialEndValue,
            zoomOnMouseWheel: "ctrl",
            moveOnMouseMove: true,
            moveOnMouseWheel: false,
            preventDefaultMouseMove: true,
            minValueSpan: 1,
          },
          {
            type: "slider",
            xAxisIndex: 0,
            startValue: initialStartValue,
            endValue: initialEndValue,
            bottom: expanded ? 12 : 8,
            height: expanded ? 26 : 20,
            brushSelect: false,
            showDetail: false,
            borderColor: styles.getPropertyValue("--line").trim(),
            backgroundColor: "rgba(244, 246, 250, .86)",
            fillerColor: "rgba(98, 85, 223, .18)",
            handleStyle: { color: styles.getPropertyValue("--violet").trim(), borderColor: "#ffffff" },
            moveHandleStyle: { color: styles.getPropertyValue("--violet").trim() },
            minValueSpan: 1,
          },
        ] : [],
        tooltip: {
          trigger: "axis",
          valueFormatter: (value: unknown) => typeof value === "number" ? `${value} L` : "無資料",
        },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: axisDates,
          axisLine: { lineStyle: { color: styles.getPropertyValue("--line").trim() } },
          axisLabel: { color: styles.getPropertyValue("--muted").trim(), fontSize: expanded ? 13 : 11, formatter: (value: string) => formatChartDate(value) },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          min: 0,
          max: yAxisMaximum,
          splitNumber: 4,
          axisLabel: { color: styles.getPropertyValue("--muted").trim(), formatter: "{value} L", fontSize: expanded ? 13 : 11 },
          splitLine: { lineStyle: { color: styles.getPropertyValue("--line").trim() } },
        },
        series: devices.map((device, index) => {
          const historyByDate = new Map(device.historyDates.map((date, historyIndex) => [date, device.history[historyIndex]]));
          return {
            name: device.id,
            type: "line",
            connectNulls: true,
            smooth: 0.32,
            symbol: device.direction === "up" ? "circle" : "diamond",
            symbolSize: expanded ? 11 : 8,
            data: axisDates.map((date) => historyByDate.get(date) ?? null),
            lineStyle: { width: expanded ? 4 : 3, type: device.direction === "up" ? "solid" : "dashed" },
            areaStyle: devices.length === 1 ? { opacity: 0.1 } : undefined,
            markLine: index === 0 ? {
              silent: true,
              symbol: "none",
              label: { formatter: "警戒 20 L", color: styles.getPropertyValue("--danger").trim() },
              lineStyle: { color: styles.getPropertyValue("--danger").trim(), type: "dashed" },
              data: [{ yAxis: 20 }],
            } : undefined,
          };
        }),
      });

      const resize = () => instance.resize();
      window.addEventListener("resize", resize);
      const originalDispose = chart.dispose;
      chart.dispose = () => {
        window.removeEventListener("resize", resize);
        originalDispose.call(instance);
      };
    });

    return () => {
      disposed = true;
      chart?.dispose();
    };
  }, [devices, expanded]);

  return <div className={`history-chart ${expanded ? "expanded" : ""}`} ref={chartRoot} role="img" aria-label={`${devices.map((device) => device.id).join("、")} 最近七次油量比較折線圖`} />;
}

export default function Home() {
  const topologyRef = useRef<HTMLDivElement>(null);
  const expandedTopologyRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const expandMapButtonRef = useRef<HTMLButtonElement>(null);
  const closeMapButtonRef = useRef<HTMLButtonElement>(null);
  const expandChartButtonRef = useRef<HTMLButtonElement>(null);
  const closeChartButtonRef = useRef<HTMLButtonElement>(null);
  const manualEntryTriggerRef = useRef<HTMLButtonElement>(null);
  const closeManualEntryButtonRef = useRef<HTMLButtonElement>(null);
  const mapDragRef = useRef({ pointerId: -1, startX: 0, startY: 0, originX: 0, originY: 0, moved: false });
  const [mapSize, setMapSize] = useState({ width: 1000, height: 680 });
  const [expandedMapSize, setExpandedMapSize] = useState({ width: 1400, height: 760 });
  const [selectedSegmentId, setSelectedSegmentId] = useState("Y10-Y11");
  const [selectedDeviceId, setSelectedDeviceId] = useState("MOK3");
  const [comparedDeviceIds, setComparedDeviceIds] = useState<string[]>(["MOK3"]);
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [isMapDragging, setIsMapDragging] = useState(false);
  const [mapViewport, setMapViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [isChartExpanded, setIsChartExpanded] = useState(false);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [manualEntry, setManualEntry] = useState<ManualEntryForm>(() => ({
    deviceId: "",
    oilLevel: "",
    measuredDate: todayInTaipei(),
    inspector: "",
    recordType: "量測",
    refillAmount: "",
  }));
  const [manualEntryFeedback, setManualEntryFeedback] = useState<ManualEntryFeedback>({
    status: "idle",
    message: "登入後可將現場量測直接寫入 D1。",
  });
  const [forecastDate, setForecastDate] = useState(todayInTaipei);
  const [activeSegments, setActiveSegments] = useState<Segment[]>(segments);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [excelImport, setExcelImport] = useState<ExcelImportState>({
    status: "loading",
    message: "正在從 D1 永久資料庫讀取潤滑紀錄…",
  });

  const syncRecordsToDashboard = useCallback((records: LubricationRecord[]) => {
    const nextSegments = applyImportedRecords(segments, records);
    setActiveSegments(nextSegments);
    const latestRecord = [...records].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)).at(-1);
    if (!latestRecord) return null;
    const latestSegment = nextSegments.find((segment) => segment.devices.some((device) => device.id === latestRecord.deviceId));
    if (latestSegment) {
      setSelectedSegmentId(latestSegment.id);
      setSelectedDeviceId(latestRecord.deviceId);
      setComparedDeviceIds([latestRecord.deviceId]);
    }
    return latestRecord;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/lubrication", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { records?: LubricationRecord[]; error?: string };
        if (!response.ok || !payload.records) throw new Error(payload.error ?? "無法讀取永久資料庫。");
        if (cancelled) return;
        const latestRecord = syncRecordsToDashboard(payload.records);
        setExcelImport({
          status: "success",
          message: `D1 永久資料庫已載入 ${payload.records.length} 筆紀錄。新的 Excel 會只新增尚未存在的資料。`,
          recordCount: payload.records.length,
          deviceCount: new Set(payload.records.map((record) => record.deviceId)).size,
          latestMeasuredAt: latestRecord?.measuredAt,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setExcelImport({
          status: "error",
          message: "永久資料庫目前無法讀取，畫面暫時保留示範資料。",
          errors: [error instanceof Error ? error.message : "未知錯誤"],
        });
      });
    return () => { cancelled = true; };
  }, [syncRecordsToDashboard]);

  useEffect(() => {
    const element = topologyRef.current;
    if (!element) return;
    const updateSize = () => setMapSize({ width: element.clientWidth, height: element.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isMapExpanded) return;
    const element = expandedTopologyRef.current;
    if (!element) return;
    const updateSize = () => setExpandedMapSize({ width: element.clientWidth, height: element.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isMapExpanded]);

  useEffect(() => {
    if (!isMapExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeMapButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMapExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMapExpanded]);

  useEffect(() => {
    if (!isChartExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeChartButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsChartExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isChartExpanded]);

  useEffect(() => {
    if (!isManualEntryOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeManualEntryButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || manualEntryFeedback.status === "saving") return;
      setIsManualEntryOpen(false);
      window.requestAnimationFrame(() => manualEntryTriggerRef.current?.focus());
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isManualEntryOpen, manualEntryFeedback.status]);

  const closeExpandedChart = () => {
    setIsChartExpanded(false);
    window.requestAnimationFrame(() => expandChartButtonRef.current?.focus());
  };

  const openExpandedMap = () => {
    setMapViewport({ x: 0, y: 0, scale: 1 });
    setIsMapExpanded(true);
  };

  const closeExpandedMap = () => {
    setIsMapExpanded(false);
    setIsMapDragging(false);
    window.requestAnimationFrame(() => expandMapButtonRef.current?.focus());
  };

  const clampMapScale = (scale: number) => Math.min(3, Math.max(0.6, scale));

  const zoomExpandedMap = (change: number) => {
    setMapViewport((current) => {
      const nextScale = clampMapScale(current.scale + change);
      const ratio = nextScale / current.scale;
      const centerX = expandedMapSize.width / 2;
      const centerY = expandedMapSize.height / 2;
      return {
        scale: nextScale,
        x: centerX - (centerX - current.x) * ratio,
        y: centerY - (centerY - current.y) * ratio,
      };
    });
  };

  const handleExpandedMapWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    setMapViewport((current) => {
      const nextScale = clampMapScale(current.scale * (event.deltaY < 0 ? 1.12 : 0.89));
      const ratio = nextScale / current.scale;
      return {
        scale: nextScale,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
      };
    });
  };

  const handleExpandedMapPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    mapDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: mapViewport.x,
      originY: mapViewport.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsMapDragging(true);
  };

  const handleExpandedMapPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = mapDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) drag.moved = true;
    setMapViewport((current) => ({ ...current, x: drag.originX + deltaX, y: drag.originY + deltaY }));
  };

  const handleExpandedMapPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mapDragRef.current.pointerId !== event.pointerId) return;
    mapDragRef.current.pointerId = -1;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsMapDragging(false);
  };

  const layout = useMemo(() => calculateRouteLayout(mapSize.width, mapSize.height), [mapSize]);
  const expandedLayout = useMemo(
    () => calculateRouteLayout(expandedMapSize.width, expandedMapSize.height),
    [expandedMapSize],
  );
  const activeRouteSegments = useMemo(() => [...activeSegments].reverse(), [activeSegments]);
  const selectedSegment = useMemo(
    () => activeSegments.find((segment) => segment.id === selectedSegmentId) ?? activeSegments[4],
    [activeSegments, selectedSegmentId],
  );
  const selectedDevice = useMemo(
    () => selectedSegment.devices.find((device) => device.id === selectedDeviceId) ?? null,
    [selectedDeviceId, selectedSegment],
  );
  const selectedConsumptionBaseline = useMemo(
    () => calculateConsumptionBaseline(baselineRecordsForDevice(selectedDevice)),
    [selectedDevice],
  );
  const forecastDays = 2;
  const expectedOilLevel = selectedDevice
    ? forecastOilLevel(selectedDevice.value, selectedConsumptionBaseline.dailyConsumptionBaseline, forecastDays)
    : null;
  const visibleBaselineSegments = selectedConsumptionBaseline.segments.slice(-3);
  const visibleBaselineStartIndex = selectedConsumptionBaseline.segments.length - visibleBaselineSegments.length;
  const latestBaselineRecord = selectedConsumptionBaseline.latestRecord;
  const forecastElapsedDays = latestBaselineRecord
    ? calendarDaysBetween(latestBaselineRecord.measuredAt, forecastDate)
    : null;
  const datedExpectedOilLevel = selectedDevice
    && hasDeviceData(selectedDevice)
    && forecastElapsedDays !== null
    && forecastElapsedDays >= 0
    ? forecastOilLevel(
      latestBaselineRecord?.oilLevel ?? selectedDevice.value,
      selectedConsumptionBaseline.dailyConsumptionBaseline,
      forecastElapsedDays,
    )
    : null;
  const forecastDateState = !latestBaselineRecord || selectedConsumptionBaseline.dailyConsumptionBaseline === null
    ? "insufficient"
    : forecastElapsedDays === null || forecastElapsedDays < 0
      ? "invalid"
      : "ready";
  const datedForecastStatus = forecastDateState === "ready" && datedExpectedOilLevel !== null
    ? oilLevelStatus(datedExpectedOilLevel)
    : null;
  const comparedDevices = useMemo(
    () => comparedDeviceIds
      .map((id) => selectedSegment.devices.find((device) => device.id === id))
      .filter((device): device is Device => Boolean(device) && hasDeviceData(device as Device)),
    [comparedDeviceIds, selectedSegment],
  );
  const selectedSegmentState = segmentStatus(selectedSegment);
  const upDevices = devicesByDirection(selectedSegment, "up");
  const downDevices = devicesByDirection(selectedSegment, "down");

  const allDeviceRecords = useMemo(() => activeSegments.flatMap((segment) => (
    segment.devices.map((device) => ({ device, segment }))
  )), [activeSegments]);
  const alerts = useMemo(() => allDeviceRecords
    .filter(({ device }) => device.status === "critical" || device.status === "warning")
    .sort((a, b) => statusPriority[b.device.status] - statusPriority[a.device.status] || a.device.value - b.device.value)
    .slice(0, 6), [allDeviceRecords]);
  const criticalCount = allDeviceRecords.filter(({ device }) => device.status === "critical").length;
  const warningCount = allDeviceRecords.filter(({ device }) => device.status === "warning").length;
  const manualDeviceOptions = useMemo(() => Array.from(new Set(allDeviceRecords.map(({ device }) => device.id)))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true })), [allDeviceRecords]);

  const openManualEntry = () => {
    setManualEntry({
      deviceId: selectedDevice?.id ?? manualDeviceOptions[0] ?? "",
      oilLevel: selectedDevice && hasDeviceData(selectedDevice) ? String(selectedDevice.value) : "",
      measuredDate: todayInTaipei(),
      inspector: "",
      recordType: "量測",
      refillAmount: "",
    });
    setManualEntryFeedback({ status: "idle", message: "填寫完成後會立即同步至 D1 永久資料庫。" });
    setIsManualEntryOpen(true);
  };

  const closeManualEntry = () => {
    if (manualEntryFeedback.status === "saving") return;
    setIsManualEntryOpen(false);
    window.requestAnimationFrame(() => manualEntryTriggerRef.current?.focus());
  };

  const submitManualEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const oilLevel = Number(manualEntry.oilLevel);
    const refillAmount = manualEntry.recordType === "補油" ? Number(manualEntry.refillAmount) : null;
    if (!manualEntry.deviceId || !manualEntry.measuredDate || !Number.isFinite(oilLevel) || oilLevel < 0) {
      setManualEntryFeedback({ status: "error", message: "請完整填寫設備、現場油量與量測日期。" });
      return;
    }
    if (manualEntry.recordType === "補油" && (!Number.isFinite(refillAmount) || refillAmount === null || refillAmount <= 0)) {
      setManualEntryFeedback({ status: "error", message: "補油紀錄必須填寫大於 0 的本次補油量。" });
      return;
    }

    const record: LubricationRecord = {
      deviceId: manualEntry.deviceId,
      measuredAt: `${manualEntry.measuredDate}T00:00:00`,
      oilLevel: Number(oilLevel.toFixed(2)),
      inspector: manualEntry.inspector.trim() || "未指定",
      recordType: manualEntry.recordType,
      refillAmount: manualEntry.recordType === "補油" ? Number(refillAmount!.toFixed(2)) : null,
    };

    setManualEntryFeedback({ status: "saving", message: "正在寫入 D1 並更新監測畫面…" });
    try {
      const response = await fetch("/api/lubrication", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: `現場登記-${record.deviceId}-${manualEntry.measuredDate}`,
          fileHash: `manual-${crypto.randomUUID()}`,
          records: [record],
        }),
      });
      const payload = await response.json() as {
        records?: LubricationRecord[];
        insertedCount?: number;
        duplicateCount?: number;
        error?: string;
        details?: string[];
        conflicts?: string[];
      };
      if (!response.ok || !payload.records) {
        throw new LubricationImportError(payload.conflicts ?? payload.details ?? [payload.error ?? "現場紀錄無法寫入永久資料庫。"]);
      }

      const latestRecord = syncRecordsToDashboard(payload.records);
      const targetSegment = activeSegments.find((segment) => segment.devices.some((device) => device.id === record.deviceId));
      if (targetSegment) {
        setSelectedSegmentId(targetSegment.id);
        setSelectedDeviceId(record.deviceId);
        setComparedDeviceIds([record.deviceId]);
      }
      setExcelImport({
        status: "success",
        message: `D1 永久資料庫已同步 ${payload.records.length} 筆紀錄。新的 Excel 會只新增尚未存在的資料。`,
        recordCount: payload.records.length,
        deviceCount: new Set(payload.records.map((item) => item.deviceId)).size,
        insertedCount: payload.insertedCount ?? 0,
        duplicateCount: payload.duplicateCount ?? 0,
        latestMeasuredAt: latestRecord?.measuredAt,
      });
      setManualEntryFeedback({
        status: "success",
        message: (payload.insertedCount ?? 0) > 0
          ? `${record.deviceId}｜${manualEntry.measuredDate} ${record.recordType}紀錄已同步。`
          : `${record.deviceId}｜${manualEntry.measuredDate} 的相同紀錄已存在，未重複寫入。`,
      });
      setIsManualEntryOpen(false);
      window.requestAnimationFrame(() => manualEntryTriggerRef.current?.focus());
    } catch (error) {
      const details = error instanceof LubricationImportError
        ? error.details
        : [error instanceof Error ? error.message : "現場紀錄無法寫入永久資料庫。"];
      setManualEntryFeedback({ status: "error", message: details[0] ?? "現場紀錄無法寫入永久資料庫。" });
    }
  };

  const handleExcelImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setExcelImport({ status: "loading", message: `正在讀取 ${file.name}…`, fileName: file.name });

    try {
      const [{ records, duplicateCount }, fileHash] = await Promise.all([
        readLubricationWorkbook(file),
        sha256Hex(file),
      ]);
      const uniqueRecordCount = records.length - duplicateCount;
      const importedDeviceIds = new Set(records.map((record) => record.deviceId));
      setPendingImport({ fileName: file.name, fileHash, records, duplicateCount });
      setExcelImport({
        status: "preview",
        message: `檢查完成：${uniqueRecordCount} 筆不重複紀錄、${importedDeviceIds.size} 台設備${duplicateCount ? `，Excel 內另有 ${duplicateCount} 筆完全相同資料會略過` : ""}。確認後才會寫入 D1。`,
        fileName: file.name,
        recordCount: uniqueRecordCount,
        deviceCount: importedDeviceIds.size,
        duplicateCount,
      });
    } catch (error) {
      setPendingImport(null);
      const details = error instanceof LubricationImportError
        ? error.details
        : [error instanceof Error ? error.message : "Excel 讀取失敗，請確認檔案格式。"];
      setExcelImport({
        status: "error",
        message: "Excel 匯入失敗，請修正以下內容後再試一次。",
        fileName: file.name,
        errors: details,
      });
    } finally {
      event.target.value = "";
    }
  };

  const confirmExcelImport = async () => {
    if (!pendingImport) return;
    setExcelImport((current) => ({ ...current, status: "saving", message: `正在比對並寫入 ${pendingImport.fileName}…`, errors: undefined }));
    try {
      const response = await fetch("/api/lubrication", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pendingImport),
      });
      const payload = await response.json() as {
        records?: LubricationRecord[];
        insertedCount?: number;
        duplicateCount?: number;
        error?: string;
        details?: string[];
        conflicts?: string[];
      };
      if (!response.ok || !payload.records) {
        throw new LubricationImportError(payload.conflicts ?? payload.details ?? [payload.error ?? "無法寫入永久資料庫。"]);
      }

      const latestRecord = syncRecordsToDashboard(payload.records);
      const insertedCount = payload.insertedCount ?? 0;
      const duplicateCount = payload.duplicateCount ?? 0;
      setPendingImport(null);
      setExcelImport({
        status: "success",
        message: `D1 寫入完成：新增 ${insertedCount} 筆、略過 ${duplicateCount} 筆相同資料；資料庫目前共有 ${payload.records.length} 筆。`,
        fileName: pendingImport.fileName,
        recordCount: payload.records.length,
        deviceCount: new Set(payload.records.map((record) => record.deviceId)).size,
        insertedCount,
        duplicateCount,
        latestMeasuredAt: latestRecord?.measuredAt,
      });
    } catch (error) {
      const details = error instanceof LubricationImportError
        ? error.details
        : [error instanceof Error ? error.message : "Excel 無法寫入永久資料庫。"];
      setExcelImport((current) => ({
        ...current,
        status: "error",
        message: "本次整批沒有寫入，請確認衝突資料後再試一次。",
        errors: details,
      }));
    }
  };

  const cancelPendingImport = () => {
    setPendingImport(null);
    setExcelImport((current) => ({
      status: "success",
      message: "已取消這次匯入；D1 內既有資料沒有變動。",
      recordCount: current.recordCount,
      deviceCount: current.deviceCount,
      latestMeasuredAt: current.latestMeasuredAt,
    }));
  };

  const chooseDefaultDevice = (segment: Segment) => {
    return [...segment.devices].sort((a, b) => (
      Number(hasDeviceData(b)) - Number(hasDeviceData(a))
      || statusPriority[b.status] - statusPriority[a.status]
      || a.value - b.value
    ))[0] ?? null;
  };

  const selectSegment = (segment: Segment) => {
    const defaultDevice = chooseDefaultDevice(segment);
    setSelectedSegmentId(segment.id);
    setSelectedDeviceId(defaultDevice?.id ?? "");
    setComparedDeviceIds(defaultDevice ? [defaultDevice.id] : []);
  };

  const selectDevice = (segment: Segment, device: Device) => {
    setSelectedSegmentId(segment.id);
    setSelectedDeviceId(device.id);
    setComparedDeviceIds(hasDeviceData(device) ? [device.id] : []);
  };

  const locateDeviceOnMap = (segment: Segment, device: Device) => {
    selectDevice(segment, device);
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      workspaceRef.current?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  const focusDevice = (segment: Segment, device: Device) => {
    if (segment.id !== selectedSegmentId) {
      selectDevice(segment, device);
      return;
    }
    setSelectedDeviceId(device.id);
    if (hasDeviceData(device) && !comparedDeviceIds.includes(device.id)) {
      setComparedDeviceIds([...comparedDeviceIds, device.id]);
    }
  };

  const toggleComparedDevice = (device: Device) => {
    if (!hasDeviceData(device)) return;
    const isCompared = comparedDeviceIds.includes(device.id);
    const nextIds = isCompared
      ? comparedDeviceIds.filter((id) => id !== device.id)
      : [...comparedDeviceIds, device.id];

    if (!nextIds.length) return;
    setComparedDeviceIds(nextIds);
    if (!nextIds.includes(selectedDeviceId)) {
      setSelectedDeviceId(nextIds[0]);
    }
  };

  const renderDeviceLane = (segment: Segment, direction: Direction, angle: number) => {
    const laneDevices = devicesByDirection(segment, direction);
    const fallback = direction === "up" ? segment.fallbackUp : segment.fallbackDown;
    if (!laneDevices.length) {
      return <span className={`fallback-track ${fallback}`} aria-hidden="true"></span>;
    }
    return [...laneDevices].reverse().map((device) => {
      const hasData = hasDeviceData(device);
      const readingText = hasData ? `${device.value} L` : "無資料";
      return (
      <button
        type="button"
        key={device.id}
        className={`device-track device-${device.id.toLowerCase()} ${device.status} ${selectedDeviceId === device.id ? "selected" : ""} ${comparedDeviceIds.includes(device.id) ? "compared" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          selectDevice(segment, device);
        }}
        title={`${device.id}｜${hasData ? statusText[device.status] : "無資料"}｜${readingText}`}
        aria-label={`${device.id}，${hasData ? statusText[device.status] : "無資料"}，${readingText}`}
      >
        <span
          className={`device-track-label label-${direction}`}
          style={{ transform: `translateX(-50%) rotate(${-angle}deg)` }}
        >{device.id}</span>
      </button>
      );
    });
  };

  const renderDeviceCards = (laneDevices: Device[]) => laneDevices.map((device) => {
    const isFocused = selectedDeviceId === device.id;
    const isCompared = comparedDeviceIds.includes(device.id);
    const hasData = hasDeviceData(device);
    return (
      <div
        className={`device-card ${device.status} ${hasData ? "" : "no-data"} ${isFocused ? "selected" : ""} ${isCompared ? "compare-active" : ""}`}
        key={device.id}
      >
        <button
          type="button"
          className="device-card-main"
          onClick={() => focusDevice(selectedSegment, device)}
          aria-label={`查看 ${device.id} 詳細資料`}
        >
          <span><i></i>{device.id}</span>
          <strong>{hasData ? `${device.value} L` : "無資料"}</strong>
          <small>{hasData ? formatChange(device.change) : "尚未匯入"}</small>
        </button>
        <button
          type="button"
          className={`compare-toggle ${isCompared ? "checked" : ""}`}
          onClick={() => toggleComparedDevice(device)}
          aria-pressed={isCompared}
          disabled={!hasData}
          aria-label={`${isCompared ? "取消" : "加入"} ${device.id} 趨勢比較`}
          title={`${isCompared ? "取消" : "加入"}圖表比較`}
        >
          {isCompared ? "✓" : ""}
        </button>
      </div>
    );
  });

  const renderTopology = (activeLayout: RouteLayout) => (
    <>
      {activeSegments.map((segment) => {
        const geometry = activeLayout.segmentGeometry[segment.id];
        if (!geometry) return null;
        const active = selectedSegmentId === segment.id;
        return (
          <div
            className={`map-segment-group ${active ? "selected" : ""}`}
            key={segment.id}
            style={{
              left: `${geometry.x.toFixed(2)}px`,
              top: `${geometry.y.toFixed(2)}px`,
              width: `${geometry.length.toFixed(2)}px`,
              transform: `translateY(-50%) rotate(${geometry.angle}deg)`,
            }}
          >
            <button
              type="button"
              className="interval-hit"
              onClick={() => selectSegment(segment)}
              aria-pressed={active}
              aria-label={`選取 ${stations[segment.from].name}至${stations[segment.to].name}區間設備`}
            ></button>
            <div className="track-lane lane-up">
              {renderDeviceLane(segment, "up", geometry.angle)}
            </div>
            <div className="track-lane lane-down">
              {renderDeviceLane(segment, "down", geometry.angle)}
            </div>
          </div>
        );
      })}

      {stations.map((station, index) => {
        const point = activeLayout.stationPoints[station.id];
        if (!point) return null;
        const active = selectedSegment.from === index || selectedSegment.to === index;
        const state = stationStatus(index, activeSegments);
        return (
          <div
            className={`map-station station-${station.id.toLowerCase()} label-${point.labelSide} ${active ? "selected" : ""}`}
            key={station.id}
            style={{ left: `${point.x.toFixed(2)}px`, top: `${point.y.toFixed(2)}px` }}
            title={`${station.id} ${station.name}站`}
          >
            <span className="station-node">{station.id}</span>
            <span className="station-label"><strong>{station.name}</strong><small>{station.id}</small></span>
            <i className={`station-state ${state}`}></i>
          </div>
        );
      })}

      <div className="depot-marker">
        <span>南機廠</span><small>31 個磨耗量測點</small>
      </div>
    </>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span></span><span></span></div>
          <div>
            <p className="eyebrow">NEW TAIPEI METRO · O&amp;M</p>
            <h1>環狀線鋼軌狀態監測中心</h1>
          </div>
        </div>
        <nav className="topnav" aria-label="主要功能">
          <a href="/" className="nav-item active" aria-current="page">潤滑設備總覽</a>
          <a href="/wear" className="nav-item">正面軌道總覽</a>
          <a href="/side-wear" className="nav-item">側面軌道總覽</a>
        </nav>
        <div className="sync-state"><span className="pulse-dot"></span>{excelImport.status === "success" ? "D1 永久資料庫已同步" : excelImport.status === "loading" || excelImport.status === "saving" ? "資料庫同步中" : "資料庫等待確認"}</div>
      </header>

      <section className="page-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow dark">LINE CONDITION OVERVIEW</p>
            <h2>從軌道線段直接定位設備</h2>
            <p>區間長度依設備數量自動配置；點軌道查看單台設備，再勾選同區間設備即可在一張圖比較多條曲線。</p>
          </div>
          <div className="updated-at">資料時間 <strong>{excelImport.latestMeasuredAt ? formatMeasurementTime(excelImport.latestMeasuredAt) : "讀取中"}</strong></div>
        </div>

        <div className="data-entry-grid">
          <section className={`excel-import-panel ${excelImport.status}`} aria-labelledby="excel-import-title">
            <div className="excel-import-icon" aria-hidden="true"><span>XL</span></div>
            <div className="excel-import-copy">
              <span className="panel-kicker">LUBRICATION DATA IMPORT</span>
              <h3 id="excel-import-title">匯入潤滑設備 Excel</h3>
              <p>先檢查預覽，再寫入 D1。完全相同資料會略過；同設備、同日期但內容不同時會整批阻擋。</p>
            </div>
            <div className="excel-import-actions">
              <a className="excel-template-link" href="/潤滑設備量測匯入範本.xlsx" download>下載 Excel 範本</a>
              <button type="button" className="excel-import-button" onClick={() => excelInputRef.current?.click()} disabled={excelImport.status === "loading" || excelImport.status === "saving"}>
                {excelImport.status === "loading" ? "讀取中…" : pendingImport ? "重新選擇 Excel" : "選擇 Excel 匯入"}
              </button>
              <input ref={excelInputRef} className="visually-hidden-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleExcelImport} />
              {pendingImport ? <button type="button" className="excel-confirm-button" onClick={confirmExcelImport} disabled={excelImport.status === "saving"}>{excelImport.status === "saving" ? "寫入中…" : "確認寫入 D1"}</button> : null}
              {pendingImport ? <button type="button" className="excel-reset-button" onClick={cancelPendingImport} disabled={excelImport.status === "saving"}>取消</button> : null}
            </div>
            <div className="excel-import-result" role="status" aria-live="polite">
              <strong>{excelImport.status === "error" ? "需要修正" : excelImport.status === "success" ? "資料庫已同步" : excelImport.status === "preview" ? "等待確認" : excelImport.status === "saving" ? "正在寫入" : excelImport.status === "loading" ? "正在處理" : "尚未匯入"}</strong>
              <span>{excelImport.message}</span>
              {excelImport.errors?.length ? <ul>{excelImport.errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
            </div>
          </section>

          <section className={`manual-entry-panel ${manualEntryFeedback.status}`} aria-labelledby="manual-entry-panel-title">
            <div className="manual-entry-icon" aria-hidden="true">＋</div>
            <div className="manual-entry-copy">
              <span className="panel-kicker">ON-SITE MEASUREMENT</span>
              <h3 id="manual-entry-panel-title">現場登記</h3>
              <p>現場量測完成後直接登記，確認後即時寫入 D1 並更新監測畫面。</p>
            </div>
            <button
              type="button"
              className="manual-entry-open-button"
              ref={manualEntryTriggerRef}
              onClick={openManualEntry}
              aria-haspopup="dialog"
            ><span aria-hidden="true">＋</span>登記現場量測</button>
            <div className="manual-entry-feedback" role="status" aria-live="polite">
              <strong>{manualEntryFeedback.status === "success" ? "現場紀錄已同步" : manualEntryFeedback.status === "error" ? "登記未完成" : "即時寫入"}</strong>
              <span>{manualEntryFeedback.message}</span>
            </div>
          </section>
        </div>

        <section className="summary-grid" aria-label="全線摘要">
          <article className="summary-card danger-card"><span>需處理設備</span><strong>{criticalCount}</strong><small>優先安排現場複查</small></article>
          <article className="summary-card warning-card"><span>注意設備</span><strong>{warningCount}</strong><small>持續觀察下降趨勢</small></article>
          <article className="summary-card"><span>固定潤滑設備</span><strong>{allDeviceRecords.length}</strong><small>MOK 10 · LB 10</small></article>
        </section>

        <section className="workspace-grid" ref={workspaceRef}>
          <article className="panel route-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">設備權重 · 實際路線走向</span>
                <h3>Y19 新北產業園區－Y6 大坪林</h3>
              </div>
              <div className="map-heading-actions">
                <div className="legend" aria-label="軌道狀態圖例">
                  <span><i className="legend-line normal"></i>正常</span>
                  <span><i className="legend-line warning"></i>注意</span>
                  <span><i className="legend-line critical"></i>需處理</span>
                  <span><i className="legend-line unknown"></i>尚無資料</span>
                </div>
                <button
                  type="button"
                  className="expand-map-button"
                  ref={expandMapButtonRef}
                  onClick={openExpandedMap}
                  aria-haspopup="dialog"
                  aria-label="放大環狀線地圖"
                ><i aria-hidden="true">⛶</i>放大地圖</button>
              </div>
            </div>

            <div className="topology-stage" ref={topologyRef} role="group" aria-label="環狀線 Y19 至 Y6 設備權重 L 型軌道圖">
              <div className="map-orientation"><span>北</span><i></i></div>
              {renderTopology(layout)}
            </div>

            <div className="mobile-route-list" aria-label="環狀線行動版設備列表">
              {routeStations.map((station, routeIndex) => {
                const nextSegment = activeRouteSegments[routeIndex];
                return (
                  <div className="mobile-route-item" key={station.id}>
                    <div className="mobile-station"><span>{station.id}</span><strong>{station.name}</strong></div>
                    {nextSegment && (
                      <div className={`mobile-segment ${selectedSegmentId === nextSegment.id ? "selected" : ""}`}>
                        <button type="button" className="mobile-interval" onClick={() => selectSegment(nextSegment)}>
                          {nextSegment.id}｜查看區間
                        </button>
                        <div className="mobile-device-row">
                          {nextSegment.devices.map((device) => (
                            <button
                              type="button"
                              key={device.id}
                              className={`${device.status} ${selectedDeviceId === device.id ? "selected" : ""} ${comparedDeviceIds.includes(device.id) ? "compared" : ""}`}
                              onClick={() => selectDevice(nextSegment, device)}
                            >{device.id}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="route-footnote">
              <span><i className="up-rail"></i>MOK 上行軌</span>
              <span><i className="down-rail"></i>LB 下行軌</span>
              <p>W = 1 + 0.75X｜總權重 {layout.totalWeight.toFixed(1)}｜1 單位約 {layout.unit.toFixed(0)}px｜轉折站 {layout.bendStation}</p>
            </div>
          </article>

          <aside className="panel detail-panel">
            <div className="detail-title-row">
              <div>
                <span className="panel-kicker">選取區間</span>
                <h3>{stations[selectedSegment.from].id} {stations[selectedSegment.from].name}</h3>
                <p>至 {stations[selectedSegment.to].id} {stations[selectedSegment.to].name}</p>
              </div>
              <span className={`status-pill ${selectedSegmentState}`}>{statusText[selectedSegmentState]}</span>
            </div>

            <section className="device-overview" aria-label="區間設備總覽">
              <div className="section-title-row">
                <div><span className="panel-kicker">區間設備</span><h4>{selectedSegment.devices.length || 0} 台設備</h4></div>
                <small>點卡片查看；右上角勾選可疊加比較</small>
              </div>

              {selectedSegment.devices.length ? (
                <>
                  <div className="device-direction-group">
                    <div className="device-direction-title"><span className="direction-mark up"></span><strong>MOK 上行</strong><small>{statusText[directionStatus(selectedSegment, "up")]}</small></div>
                    <div className="device-card-grid">
                      {renderDeviceCards(upDevices)}
                    </div>
                  </div>
                  <div className="device-direction-group">
                    <div className="device-direction-title"><span className="direction-mark down"></span><strong>LB 下行</strong><small>{statusText[directionStatus(selectedSegment, "down")]}</small></div>
                    <div className="device-card-grid">
                      {renderDeviceCards(downDevices)}
                    </div>
                  </div>
                </>
              ) : (
                <div className="no-device-message"><strong>此區間尚無固定設備資料</strong><span>無資料不能判定為正常。</span></div>
              )}

              {selectedDevice ? (
                <article className="consumption-baseline-card" aria-labelledby="consumption-baseline-title">
                  <header className="consumption-baseline-header">
                    <div>
                      <span className="panel-kicker">CONSUMPTION BASELINE</span>
                      <h5 id="consumption-baseline-title">每日平均耗油量</h5>
                    </div>
                    <span className={`consumption-baseline-badge ${selectedConsumptionBaseline.dailyConsumptionBaseline !== null ? "ready" : "empty"}`}>
                      {selectedConsumptionBaseline.dailyConsumptionBaseline !== null
                        ? `${selectedConsumptionBaseline.segments.length} 個完整區間`
                        : "資料不足"}
                    </span>
                  </header>

                  <div className="consumption-baseline-summary">
                    <div className="consumption-baseline-metric primary">
                      <span>正式 baseline</span>
                      <strong>
                        {selectedConsumptionBaseline.dailyConsumptionBaseline !== null
                          ? selectedConsumptionBaseline.dailyConsumptionBaseline.toFixed(2)
                          : "—"} <small>L／日</small>
                      </strong>
                      <small>
                        {selectedConsumptionBaseline.dailyConsumptionBaseline !== null
                          ? `總權重 ${formatBaselineDays(selectedConsumptionBaseline.totalCommittedDays)} 天`
                          : "等待完整下降區間"}
                      </small>
                    </div>

                    <div className="consumption-baseline-metric forecast">
                      <span>{forecastDays} 天後預估油量</span>
                      <strong>{expectedOilLevel !== null ? expectedOilLevel.toFixed(1) : "—"} <small>L</small></strong>
                      <small>
                        {selectedConsumptionBaseline.dailyConsumptionBaseline !== null && hasDeviceData(selectedDevice)
                          ? `${selectedDevice.value.toFixed(1)} − ${selectedConsumptionBaseline.dailyConsumptionBaseline.toFixed(2)} × ${forecastDays}`
                          : "建立 baseline 後計算"}
                      </small>
                    </div>
                  </div>

                  {selectedConsumptionBaseline.provisionalSegment ? (
                    <div className="consumption-baseline-provisional">
                      <div>
                        <span>進行中區間・尚未納入</span>
                        <small>
                          {formatBaselineDate(selectedConsumptionBaseline.provisionalSegment.startDate)} → {formatBaselineDate(selectedConsumptionBaseline.provisionalSegment.endDate)}
                        </small>
                      </div>
                      <strong>{selectedConsumptionBaseline.provisionalSegment.dailyRate.toFixed(2)} L／日</strong>
                    </div>
                  ) : null}

                  <div className="consumption-baseline-source-heading">
                    <strong>Baseline 來源區間</strong>
                    <small>{visibleBaselineSegments.length ? `最近 ${visibleBaselineSegments.length} 段` : "尚未建立"}</small>
                  </div>

                  {visibleBaselineSegments.length ? (
                    <div className="consumption-baseline-sources">
                      {visibleBaselineSegments.map((segment, index) => (
                        <article className="consumption-baseline-source" key={`${segment.startDate}-${segment.endDate}`}>
                          <div className="consumption-baseline-source-title">
                            <strong>區間 {visibleBaselineStartIndex + index + 1}</strong>
                            <span>{formatBaselineDate(segment.startDate)} → {formatBaselineDate(segment.endDate)}</span>
                          </div>
                          <strong className="consumption-baseline-source-rate">
                            {segment.dailyRate.toFixed(2)} <small>L／日</small>
                          </strong>
                          <div className="consumption-baseline-source-meta">
                            <span>{segment.startLevel.toFixed(1)} → {segment.endLevel.toFixed(1)} L</span>
                            <span>耗油 {segment.consumption.toFixed(1)} L</span>
                            <span className="weight">權重 {formatBaselineDays(segment.weight)} 天</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="consumption-baseline-empty">
                      {selectedConsumptionBaseline.sourceRecordCount < 2
                        ? "至少需要兩筆量測，並在補油後完成一段下降歷程。"
                        : "目前只有進行中的下降區間；遇到補油或明顯上升後才會正式結算。"}
                    </div>
                  )}

                  <footer className="consumption-baseline-rule">
                    補油事件優先；無事件時，單次上升超過 1.0 L 才切分區間。
                  </footer>
                </article>
              ) : null}
            </section>

            {selectedDevice ? (
              <section className="selected-device-detail">
                <div className="selected-device-heading">
                  <div>
                    <span className="panel-kicker">目前查看設備</span>
                    <h4>{selectedDevice.id}</h4>
                  </div>
                  <span className={`status-pill ${selectedDevice.status}`}>{hasDeviceData(selectedDevice) ? statusText[selectedDevice.status] : "無資料"}</span>
                </div>
                <div className="device-reading-grid">
                  <div><span>目前油量</span><strong>{hasDeviceData(selectedDevice) ? `${selectedDevice.value} L` : "無資料"}</strong></div>
                  <div><span>相比前次</span><strong className={selectedDevice.change < 0 ? "danger-text" : ""}>{hasDeviceData(selectedDevice) ? formatChange(selectedDevice.change) : "—"}</strong></div>
                  <div><span>所在軌道</span><strong>{selectedDevice.direction === "up" ? "MOK 上行" : "LB 下行"}</strong></div>
                  {selectedDevice.latestRecord ? (
                    <>
                      <div><span>最新量測</span><strong>{formatMeasurementTime(selectedDevice.latestRecord.measuredAt)}</strong></div>
                      <div><span>檢修人員</span><strong>{selectedDevice.latestRecord.inspector}</strong></div>
                      <div><span>紀錄類型</span><strong>{selectedDevice.latestRecord.recordType}{selectedDevice.latestRecord.refillAmount ? ` · +${selectedDevice.latestRecord.refillAmount} L` : ""}</strong></div>
                    </>
                  ) : null}
                </div>
                <div className="comparison-strip">
                  <span>圖表已勾選</span>
                  <div>{comparedDevices.map((device, index) => (
                    <strong key={device.id} style={{ "--series-color": comparisonColors[index % comparisonColors.length] } as CSSProperties}>
                      <i></i>{device.id}
                    </strong>
                  ))}</div>
                </div>
                <div className="chart-heading">
                  <strong>{hasDeviceData(selectedDevice) ? (comparedDevices.length > 1 ? `${comparedDevices.length} 台設備趨勢比較` : `${selectedDevice.id} 油量歷程`) : `${selectedDevice.id} 尚無量測歷程`}</strong>
                  <div className="chart-heading-actions">
                    <span>拖曳左右移動 · Ctrl＋滾輪縮放 · 單位：L</span>
                    <button
                      type="button"
                      className="expand-chart-button"
                      ref={expandChartButtonRef}
                      onClick={() => setIsChartExpanded(true)}
                      disabled={!hasDeviceData(selectedDevice)}
                      aria-haspopup="dialog"
                      aria-label="放大油量趨勢圖"
                    ><i aria-hidden="true">⛶</i>放大</button>
                  </div>
                </div>
                {hasDeviceData(selectedDevice) ? (
                  <HistoryChart devices={comparedDevices} />
                ) : (
                  <div className="chart-empty-state"><strong>無資料</strong><span>這份 Excel 尚未提供 {selectedDevice.id} 的量測紀錄。</span></div>
                )}
                <div className={`detail-note ${selectedDevice.status}`}>
                  <strong>維修提示</strong>
                  <p>{!hasDeviceData(selectedDevice) ? "目前沒有量測資料，請確認 Excel 是否已填入這台設備。" : selectedDevice.status === "critical" ? "請優先核對現場油量、噴塗週期與最近一次補充紀錄。" : selectedDevice.status === "warning" ? "目前接近警戒值，請持續觀察下降速度並安排複查。" : "設備目前正常，持續依既定週期監測。"}</p>
                </div>
                <section className={`dated-forecast-card ${forecastDateState}`} aria-labelledby="dated-forecast-title">
                  <div className="dated-forecast-heading">
                    <div>
                      <span className="panel-kicker">DATE-BASED FORECAST</span>
                      <h5 id="dated-forecast-title">指定日期油量預估</h5>
                    </div>
                    <button type="button" onClick={() => setForecastDate(todayInTaipei())}>NOW</button>
                  </div>
                  <label className="dated-forecast-input">
                    <span>預估日期</span>
                    <input
                      type="date"
                      value={forecastDate}
                      onChange={(event) => setForecastDate(event.target.value)}
                      aria-describedby="dated-forecast-description"
                    />
                  </label>
                  <div className={`dated-forecast-result ${datedForecastStatus ?? ""}`} aria-live="polite">
                    <div className="dated-forecast-result-heading">
                      <span>系統預估油量</span>
                      {datedForecastStatus ? <em>{statusText[datedForecastStatus]}</em> : null}
                    </div>
                    <strong>
                      {forecastDateState === "ready" && datedExpectedOilLevel !== null
                        ? `${datedExpectedOilLevel.toFixed(1)} L`
                        : forecastDateState === "invalid"
                          ? "日期不適用"
                          : "資料不足"}
                    </strong>
                    <small id="dated-forecast-description">
                      {forecastDateState === "ready" && datedExpectedOilLevel !== null && latestBaselineRecord
                        ? `以 ${formatMeasurementTime(latestBaselineRecord.measuredAt)} 的 ${latestBaselineRecord.oilLevel.toFixed(1)} L，經過 ${forecastElapsedDays} 天，按 ${selectedConsumptionBaseline.dailyConsumptionBaseline?.toFixed(2)} L／日推估。`
                        : forecastDateState === "invalid" && latestBaselineRecord
                          ? `請選擇 ${latestBaselineRecord.measuredAt.slice(0, 10)} 或之後的日期。`
                          : "尚未建立完整的歷史消耗區間，無法產生預估值。"}
                    </small>
                  </div>
                </section>
              </section>
            ) : (
              <div className="chart-empty-state"><strong>尚未選取設備</strong><span>請點擊地圖上的 MOK／LB 小線段。</span></div>
            )}
          </aside>
        </section>

        {isManualEntryOpen ? (
          <div
            className="manual-entry-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeManualEntry();
            }}
          >
            <section
              className="manual-entry-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="manual-entry-title"
              aria-describedby="manual-entry-description"
            >
              <header className="manual-entry-modal-header">
                <div>
                  <span className="panel-kicker">ON-SITE MEASUREMENT</span>
                  <h3 id="manual-entry-title"><span aria-hidden="true">＋</span>手動登記現場量測值</h3>
                  <p id="manual-entry-description">確認後會立即寫入 D1；人員留白時自動記錄為「未指定」。</p>
                </div>
                <button
                  type="button"
                  className="manual-entry-close"
                  ref={closeManualEntryButtonRef}
                  onClick={closeManualEntry}
                  disabled={manualEntryFeedback.status === "saving"}
                  aria-label="關閉現場登記"
                >×</button>
              </header>

              <form className="manual-entry-form" onSubmit={submitManualEntry} aria-busy={manualEntryFeedback.status === "saving"}>
                <label className="manual-entry-field full-width">
                  <span>設備名稱 <b>*</b></span>
                  <select
                    value={manualEntry.deviceId}
                    onChange={(event) => setManualEntry((current) => ({ ...current, deviceId: event.target.value }))}
                    disabled={manualEntryFeedback.status === "saving"}
                    required
                  >
                    <option value="" disabled>請選擇設備</option>
                    {manualDeviceOptions.map((deviceId) => <option key={deviceId} value={deviceId}>{deviceId}</option>)}
                  </select>
                </label>

                <div className="manual-entry-field-row">
                  <label className="manual-entry-field">
                    <span>現場顯示油量（L）<b>*</b></span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={manualEntry.oilLevel}
                      onChange={(event) => setManualEntry((current) => ({ ...current, oilLevel: event.target.value }))}
                      disabled={manualEntryFeedback.status === "saving"}
                      placeholder="例如：50"
                      required
                    />
                  </label>
                  <label className="manual-entry-field">
                    <span>量測日期 <b>*</b></span>
                    <input
                      type="date"
                      max={todayInTaipei()}
                      value={manualEntry.measuredDate}
                      onChange={(event) => setManualEntry((current) => ({ ...current, measuredDate: event.target.value }))}
                      disabled={manualEntryFeedback.status === "saving"}
                      required
                    />
                  </label>
                </div>

                <label className="manual-entry-field full-width">
                  <span>量測巡檢人員</span>
                  <input
                    type="text"
                    maxLength={100}
                    value={manualEntry.inspector}
                    onChange={(event) => setManualEntry((current) => ({ ...current, inspector: event.target.value }))}
                    disabled={manualEntryFeedback.status === "saving"}
                    placeholder="留空將自動記錄為未指定"
                  />
                </label>

                <div className="manual-entry-field-row">
                  <label className="manual-entry-field">
                    <span>狀態描述 <b>*</b></span>
                    <select
                      value={manualEntry.recordType}
                      onChange={(event) => setManualEntry((current) => ({
                        ...current,
                        recordType: event.target.value as LubricationRecord["recordType"],
                        refillAmount: event.target.value === "量測" ? "" : current.refillAmount,
                      }))}
                      disabled={manualEntryFeedback.status === "saving"}
                    >
                      <option value="量測">量測</option>
                      <option value="補油">補油</option>
                    </select>
                  </label>
                  {manualEntry.recordType === "補油" ? (
                    <label className="manual-entry-field">
                      <span>本次補油量（L）<b>*</b></span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        inputMode="decimal"
                        value={manualEntry.refillAmount}
                        onChange={(event) => setManualEntry((current) => ({ ...current, refillAmount: event.target.value }))}
                        disabled={manualEntryFeedback.status === "saving"}
                        placeholder="例如：20"
                        required
                      />
                    </label>
                  ) : <div className="manual-entry-type-note">量測紀錄只保存現場顯示油量。</div>}
                </div>

                {manualEntryFeedback.status === "error" ? (
                  <div className="manual-entry-error" role="alert">{manualEntryFeedback.message}</div>
                ) : null}

                <footer className="manual-entry-form-actions">
                  <button type="button" className="manual-entry-cancel" onClick={closeManualEntry} disabled={manualEntryFeedback.status === "saving"}>取消</button>
                  <button type="submit" className="manual-entry-submit" disabled={manualEntryFeedback.status === "saving"}>
                    {manualEntryFeedback.status === "saving" ? "同步中…" : "確認登錄並即時同步"}
                  </button>
                </footer>
              </form>
            </section>
          </div>
        ) : null}

        {isMapExpanded ? (
          <div
            className="map-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeExpandedMap();
            }}
          >
            <section
              className="map-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="expanded-map-title"
            >
              <header className="map-modal-header">
                <div>
                  <span className="panel-kicker">INTERACTIVE ROUTE MAP</span>
                  <h3 id="expanded-map-title">環狀線全線設備地圖</h3>
                  <p>拖曳移動地圖，使用滑鼠滾輪或右側按鈕縮放；線段與設備仍可直接點選。</p>
                </div>
                <button
                  type="button"
                  className="chart-modal-close"
                  ref={closeMapButtonRef}
                  onClick={closeExpandedMap}
                  aria-label="關閉放大地圖"
                >×</button>
              </header>

              <div className="map-modal-viewport-shell">
                <div
                  className={`map-modal-viewport ${isMapDragging ? "dragging" : ""}`}
                  ref={expandedTopologyRef}
                  onWheel={handleExpandedMapWheel}
                  onPointerDown={handleExpandedMapPointerDown}
                  onPointerMove={handleExpandedMapPointerMove}
                  onPointerUp={handleExpandedMapPointerEnd}
                  onPointerCancel={handleExpandedMapPointerEnd}
                  onClickCapture={(event) => {
                    if (!mapDragRef.current.moved) return;
                    event.preventDefault();
                    event.stopPropagation();
                    mapDragRef.current.moved = false;
                  }}
                  role="application"
                  aria-label="可拖曳與縮放的環狀線設備地圖"
                >
                  <div
                    className="map-pan-layer"
                    style={{
                      transform: `translate(${mapViewport.x}px, ${mapViewport.y}px) scale(${mapViewport.scale})`,
                    }}
                  >
                    {renderTopology(expandedLayout)}
                  </div>
                  <div className="map-orientation expanded-orientation"><span>北</span><i></i></div>
                  <div className="map-zoom-controls" aria-label="地圖縮放控制">
                    <button type="button" onClick={() => zoomExpandedMap(0.2)} aria-label="放大地圖">＋</button>
                    <output aria-live="polite">{Math.round(mapViewport.scale * 100)}%</output>
                    <button type="button" onClick={() => zoomExpandedMap(-0.2)} aria-label="縮小地圖">－</button>
                    <button
                      type="button"
                      className="reset-map-view"
                      onClick={() => setMapViewport({ x: 0, y: 0, scale: 1 })}
                    >重設</button>
                  </div>
                  <div className="map-drag-hint"><span aria-hidden="true">✥</span>拖曳移動 · 滾輪縮放</div>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {isChartExpanded && selectedDevice && hasDeviceData(selectedDevice) ? (
          <div
            className="chart-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeExpandedChart();
            }}
          >
            <section
              className="chart-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="expanded-chart-title"
            >
              <header className="chart-modal-header">
                <div>
                  <span className="panel-kicker">{selectedSegment.location}</span>
                  <h3 id="expanded-chart-title">
                    {comparedDevices.length > 1 ? `${comparedDevices.length} 台設備趨勢比較` : `${selectedDevice.id} 完整油量歷程`}
                  </h3>
                </div>
                <button
                  type="button"
                  className="chart-modal-close"
                  ref={closeChartButtonRef}
                  onClick={closeExpandedChart}
                  aria-label="關閉放大圖表"
                >×</button>
              </header>
              <div className="chart-modal-devices" aria-label="目前顯示設備">
                {comparedDevices.map((device, index) => (
                  <span key={device.id} style={{ "--series-color": comparisonColors[index % comparisonColors.length] } as CSSProperties}>
                    <i></i><strong>{device.id}</strong>{hasDeviceData(device) ? `${device.value} L` : "無資料"}
                  </span>
                ))}
                <small>拖曳圖表左右移動 · Ctrl＋滾輪縮放 · 下方滑桿調整範圍 · 單位：L</small>
              </div>
              <div className="chart-modal-canvas">
                <HistoryChart devices={comparedDevices} expanded />
              </div>
            </section>
          </div>
        ) : null}

        <section className="panel alerts-panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">異常清單</span><h3>優先處理設備</h3></div>
            <span className="alerts-count">{criticalCount + warningCount} 台設備需關注</span>
          </div>
          <div className="alerts-table" role="table" aria-label="低油量設備清單">
            <div className="table-row table-head" role="row"><span>設備</span><span>目前油量</span><span>軌道位置</span><span>相比前次</span><span>操作</span></div>
            {alerts.map(({ device, segment }) => (
              <div className="table-row" role="row" key={device.id}>
                <strong>{device.id}</strong>
                <span><b className={device.status === "critical" ? "danger-text" : "warning-text"}>{device.value} L</b></span>
                <span>{stations[segment.from].id} {stations[segment.from].name}－{stations[segment.to].id} {stations[segment.to].name}</span>
                <span>{formatChange(device.change)}</span>
                <button type="button" className="table-action" onClick={() => locateDeviceOnMap(segment, device)}>在圖上定位</button>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
