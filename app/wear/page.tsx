"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { predictWearTrend, projectWearAtTime } from "../lib/wearPrediction";
import type { WearPredictionConfidence } from "../lib/wearPrediction";

type RailStatus = "normal" | "warning" | "critical";
type RailSide = "left" | "right";
type Direction = "up" | "down";
type DirectionFilter = "all" | Direction;
export type WearMode = "tread" | "side";
type LabelSide = "right" | "top" | "bottom" | "upper-left" | "upper-right" | "lower-left" | "lower-right";
type ClockSyncState = "syncing" | "cloudflare" | "fallback";

type Station = { id: string; name: string };
type WearHistoryPoint = {
  date: string;
  wear: number;
  change: number;
  method: string;
};
type WearReading = {
  direction: Direction;
  side: RailSide;
  wear: number;
  change: number;
  inspectedAt: string;
  history: WearHistoryPoint[];
};
type MonitorPoint = {
  direction: Direction;
  number: number;
  segmentId: string;
  from: Station;
  to: Station;
  readings: Record<RailSide, WearReading>;
};
type RouteSegment = { id: string; from: Station; to: Station; weight: number };
type RoutePoint = { x: number; y: number; labelSide: LabelSide };
type SegmentGeometry = { x: number; y: number; length: number; angle: number };
type RouteLayout = {
  stationPoints: Record<string, RoutePoint>;
  segmentGeometry: Record<string, SegmentGeometry>;
};

const wearStations: Station[] = [
  { id: "Y19", name: "新北產業園區" },
  { id: "Y18", name: "幸福" },
  { id: "Y17", name: "頭前庄" },
  { id: "Y16", name: "新埔民生" },
  { id: "Y15", name: "板橋" },
  { id: "Y14", name: "板新" },
  { id: "Y13", name: "中原" },
  { id: "Y12", name: "橋和" },
  { id: "Y11", name: "中和" },
  { id: "Y10", name: "景安" },
  { id: "Y9", name: "景平" },
  { id: "Y8", name: "秀朗橋" },
  { id: "Y7", name: "十四張" },
  { id: "Y6", name: "大坪林" },
];

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

const stationById = Object.fromEntries(wearStations.map((station) => [station.id, station])) as Record<string, Station>;

const upMonitorAssignments = [
  { numbers: [1, 2], segmentId: "Y8-Y7", fromId: "Y7", toId: "Y8" },
  { numbers: [3, 4, 5, 6, 7], segmentId: "Y11-Y10", fromId: "Y10", toId: "Y11" },
  { numbers: [8, 9], segmentId: "Y12-Y11", fromId: "Y11", toId: "Y12" },
  { numbers: [10, 11], segmentId: "Y15-Y14", fromId: "Y14", toId: "Y15" },
  { numbers: [12], segmentId: "Y16-Y15", fromId: "Y15", toId: "Y16" },
  { numbers: [13], segmentId: "Y18-Y17", fromId: "Y17", toId: "Y18" },
  { numbers: [14, 15], segmentId: "Y19-Y18", fromId: "Y18", toId: "Y19" },
] as const;

const downMonitorAssignments = [
  { numbers: [1, 2], segmentId: "Y8-Y7", fromId: "Y8", toId: "Y7" },
  { numbers: [3, 4, 5, 6], segmentId: "Y11-Y10", fromId: "Y11", toId: "Y10" },
  { numbers: [7, 8], segmentId: "Y12-Y11", fromId: "Y12", toId: "Y11" },
  { numbers: [9, 10], segmentId: "Y15-Y14", fromId: "Y15", toId: "Y14" },
  { numbers: [11], segmentId: "Y16-Y15", fromId: "Y16", toId: "Y15" },
  { numbers: [12, 13], segmentId: "Y17-Y16", fromId: "Y17", toId: "Y16" },
  { numbers: [14], segmentId: "Y18-Y17", fromId: "Y18", toId: "Y17" },
  { numbers: [15, 16], segmentId: "Y19-Y18", fromId: "Y19", toId: "Y18" },
] as const;

const monitorCountBySegment = Object.fromEntries(routeSegmentsSeed().map((segmentId) => {
  const upCount = upMonitorAssignments.find((assignment) => assignment.segmentId === segmentId)?.numbers.length ?? 0;
  const downCount = downMonitorAssignments.find((assignment) => assignment.segmentId === segmentId)?.numbers.length ?? 0;
  return [segmentId, Math.max(upCount, downCount)];
})) as Record<string, number>;

function routeSegmentsSeed() {
  return wearStations.slice(0, -1).map((station, index) => `${station.id}-${wearStations[index + 1].id}`);
}
const routeSegments: RouteSegment[] = wearStations.slice(0, -1).map((station, index) => {
  const to = wearStations[index + 1];
  const id = `${station.id}-${to.id}`;
  return { id, from: station, to, weight: 1 + 0.75 * (monitorCountBySegment[id] ?? 0) };
});

const treadLeftWear = [1.4, 1.8, 2.7, 2.4, 3.1, 1.9, 2.6, 1.7, 2.1, 2.8, 3.2, 1.6, 2.5, 1.9, 2.2];
const treadRightWear = [1.6, 2.1, 2.5, 2.8, 3.3, 2.2, 2.9, 1.8, 2.4, 2.6, 3.1, 1.9, 2.7, 2.0, 2.45];
const sideLeftWear = [3.1, 4.4, 7.2, 5.1, 6.8, 4.6, 8.7, 3.6, 5.8, 7.9, 6.4, 4.1, 2.9, 6.4, 3.3];
const sideRightWear = [2.8, 3.9, 5.5, 7.0, 4.6, 6.8, 3.5, 6.1, 6.75, 3.7, 6.2, 4.2, 2.6, 5.9, 7.3];
const treadDownLeftWear = [1.5, 1.9, 2.6, 2.2, 3.05, 2.1, 2.5, 1.7, 2.9, 3.15, 1.8, 2.4, 2.75, 2.0, 2.3, 3.2];
const treadDownRightWear = [1.7, 2.0, 2.4, 2.7, 3.2, 2.3, 2.8, 1.9, 2.6, 3.3, 2.0, 2.55, 2.9, 2.2, 2.45, 3.4];
const sideDownLeftWear = [3.4, 4.1, 6.9, 5.4, 7.4, 4.9, 6.2, 5.7, 7.6, 6.5, 4.3, 5.9, 7.1, 3.8, 6.6, 7.8];
const sideDownRightWear = [3.0, 4.5, 5.8, 7.2, 4.8, 6.6, 3.9, 6.4, 6.9, 4.1, 6.0, 4.5, 6.8, 3.2, 5.7, 7.5];

const wearModeConfig = {
  tread: {
    title: "正面軌道總覽",
    englishTitle: "TREAD WEAR OVERVIEW",
    measurement: "踏面磨耗（頂部）",
    warning: 15.5,
    critical: 17,
    scaleMax: 20,
  },
  side: {
    title: "側面軌道總覽",
    englishTitle: "GAUGE WEAR OVERVIEW",
    measurement: "側向磨耗（側邊）",
    warning: 6.5,
    critical: 8,
    scaleMax: 10,
  },
} as const;

const statusText: Record<RailStatus, string> = { normal: "正常", warning: "管理值", critical: "維修值" };
const sideText: Record<RailSide, string> = { left: "左軌", right: "右軌" };
const directionText: Record<Direction, string> = { up: "上行", down: "下行" };
const statusPriority: Record<RailStatus, number> = { normal: 1, warning: 2, critical: 3 };
const predictionConfidenceText: Record<WearPredictionConfidence, string> = {
  insufficient: "資料不足",
  low: "低",
  medium: "中",
  high: "高",
};
const taipeiDateTimeFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatTaipeiDateTime(epochMs: number) {
  return taipeiDateTimeFormatter.format(new Date(epochMs));
}

function wearStatus(wear: number, mode: WearMode): RailStatus {
  const config = wearModeConfig[mode];
  if (wear >= config.critical) return "critical";
  if (wear >= config.warning) return "warning";
  return "normal";
}

function railCode(pointNumber: number, side: RailSide) {
  return `${side === "left" ? "L" : "R"}${pointNumber}`;
}

function railKey(direction: Direction, pointNumber: number, side: RailSide) {
  return `${direction}-${railCode(pointNumber, side)}`;
}

function mapRailCode(direction: Direction, pointNumber: number, side: RailSide) {
  return `${direction === "up" ? "上" : "下"}${side === "left" ? "L" : "R"}${pointNumber}`;
}

function makeReading(direction: Direction, side: RailSide, wear: number, index: number, mode: WearMode): WearReading {
  const dates = ["2026-01-18", "2026-02-27", "2026-04-14", "2026-05-01", "2026-05-29", "2026-06-21", `2026-07-${String(24 - (index % 5)).padStart(2, "0")}`];
  const totalGrowth = mode === "tread" ? 0.45 + (index % 4) * 0.1 : 1.0 + (index % 4) * 0.24;
  const values = dates.map((_, historyIndex) => {
    const progress = historyIndex / (dates.length - 1);
    const easedProgress = progress * 0.82 + progress * progress * 0.18;
    return Number(Math.max(0, wear - totalGrowth * (1 - easedProgress)).toFixed(2));
  });
  const history = dates.map((date, historyIndex): WearHistoryPoint => {
    const historyWear = values[historyIndex];
    const previousWear = historyIndex === 0 ? historyWear : values[historyIndex - 1];
    return {
      date,
      wear: historyWear,
      change: Number((historyWear - previousWear).toFixed(2)),
      method: historyIndex < 2 ? "歷史資料" : "手工工具量測",
    };
  });
  const latest = history[history.length - 1];
  return { direction, side, wear, change: latest.change, inspectedAt: latest.date, history };
}

function buildMonitorPoints(direction: Direction, assignments: readonly { numbers: readonly number[]; segmentId: string; fromId: string; toId: string }[], mode: WearMode, leftValues: number[], rightValues: number[]): MonitorPoint[] {
  return assignments.flatMap((assignment) => assignment.numbers.map((number) => ({
    direction,
    number,
    segmentId: assignment.segmentId,
    from: stationById[assignment.fromId],
    to: stationById[assignment.toId],
    readings: {
      left: makeReading(direction, "left", leftValues[number - 1], number - 1, mode),
      right: makeReading(direction, "right", rightValues[number - 1], number - 1, mode),
    },
  })));
}

const treadUpMonitorPoints = buildMonitorPoints("up", upMonitorAssignments, "tread", treadLeftWear, treadRightWear);
const treadDownMonitorPoints = buildMonitorPoints("down", downMonitorAssignments, "tread", treadDownLeftWear, treadDownRightWear);
const sideUpMonitorPoints = buildMonitorPoints("up", upMonitorAssignments, "side", sideLeftWear, sideRightWear);
const sideDownMonitorPoints = buildMonitorPoints("down", downMonitorAssignments, "side", sideDownLeftWear, sideDownRightWear);

function calculateRouteLayout(width: number, height: number): RouteLayout {
  const safeWidth = Math.max(width, 760);
  const safeHeight = Math.max(height, 560);
  const padding = { left: 124, right: 146, top: 72, bottom: 116 };
  const verticalAvailable = Math.max(300, safeHeight - padding.top - padding.bottom);
  const horizontalAvailable = Math.max(420, safeWidth - padding.left - padding.right);
  const verticalSegmentCount = 2;
  const diagonalEndIndex = 9;
  const weights = routeSegments.map((segment) => segment.weight);
  const verticalWeight = weights.slice(0, verticalSegmentCount).reduce((sum, weight) => sum + weight, 0);
  const diagonalWeight = weights.slice(verticalSegmentCount, diagonalEndIndex).reduce((sum, weight) => sum + weight, 0);
  const horizontalWeight = weights.slice(diagonalEndIndex).reduce((sum, weight) => sum + weight, 0);
  let bestAngle = 34;
  let bestUnit = 0;

  for (let angle = 24; angle <= 48; angle += 0.5) {
    const radians = angle * Math.PI / 180;
    const widthWeight = diagonalWeight * Math.cos(radians) + horizontalWeight;
    const heightWeight = verticalWeight + diagonalWeight * Math.sin(radians);
    const candidateUnit = Math.min(horizontalAvailable / widthWeight, verticalAvailable / heightWeight);
    if (candidateUnit > bestUnit) {
      bestUnit = candidateUnit;
      bestAngle = angle;
    }
  }

  const radians = bestAngle * Math.PI / 180;
  const routeWidth = (diagonalWeight * Math.cos(radians) + horizontalWeight) * bestUnit;
  const routeHeight = (verticalWeight + diagonalWeight * Math.sin(radians)) * bestUnit;
  let x = padding.left + Math.max(0, (horizontalAvailable - routeWidth) / 2);
  let y = padding.top + Math.max(0, (verticalAvailable - routeHeight) / 2);
  const stationPoints: Record<string, RoutePoint> = { [wearStations[0].id]: { x, y, labelSide: stationLabelSides[wearStations[0].id] } };
  const segmentGeometry: Record<string, SegmentGeometry> = {};

  routeSegments.forEach((segment, index) => {
    const length = segment.weight * bestUnit;
    const angle = index < verticalSegmentCount ? 90 : index < diagonalEndIndex ? bestAngle : 0;
    const segmentRadians = angle * Math.PI / 180;
    segmentGeometry[segment.id] = { x, y, length, angle };
    x += length * Math.cos(segmentRadians);
    y += length * Math.sin(segmentRadians);
    stationPoints[segment.to.id] = { x, y, labelSide: stationLabelSides[segment.to.id] };
  });

  return { stationPoints, segmentGeometry };
}

function worstStatus(statuses: RailStatus[]): RailStatus {
  return statuses.reduce((worst, status) => statusPriority[status] > statusPriority[worst] ? status : worst, "normal");
}

function WearHistoryChart({ reading, code, config, expanded = false }: {
  reading: WearReading;
  code: string;
  config: (typeof wearModeConfig)[WearMode];
  expanded?: boolean;
}) {
  const chartRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let chart: { dispose: () => void; resize: () => void } | undefined;
    void import("echarts").then((echarts) => {
      if (disposed || !chartRoot.current) return;
      const styles = getComputedStyle(document.documentElement);
      const instance = echarts.init(chartRoot.current);
      chart = instance;
      instance.setOption({
        animationDuration: 420,
        color: [reading.side === "left" ? "#0fa878" : "#e59a14"],
        legend: {
          top: expanded ? 10 : 2,
          left: 0,
          itemWidth: expanded ? 28 : 20,
          itemHeight: expanded ? 12 : 9,
          textStyle: { color: styles.getPropertyValue("--ink-soft").trim(), fontSize: expanded ? 13 : 11 },
          data: [code],
        },
        grid: { left: expanded ? 70 : 54, right: expanded ? 40 : 24, top: expanded ? 70 : 52, bottom: expanded ? 52 : 40 },
        tooltip: { trigger: "axis", valueFormatter: (value: unknown) => `${value} mm` },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: reading.history.map((point) => point.date.slice(5).replace("-", "/")),
          axisLine: { lineStyle: { color: styles.getPropertyValue("--line").trim() } },
          axisLabel: { color: styles.getPropertyValue("--muted").trim(), fontSize: expanded ? 13 : 11 },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          min: 0,
          max: config.scaleMax,
          splitNumber: expanded ? 6 : 4,
          axisLabel: { color: styles.getPropertyValue("--muted").trim(), formatter: "{value} mm", fontSize: expanded ? 13 : 11 },
          splitLine: { lineStyle: { color: styles.getPropertyValue("--line").trim() } },
        },
        series: [{
          name: code,
          type: "line",
          smooth: 0.28,
          symbol: reading.side === "left" ? "circle" : "diamond",
          symbolSize: expanded ? 11 : 8,
          data: reading.history.map((point) => point.wear),
          lineStyle: { width: expanded ? 4 : 3, type: reading.side === "left" ? "solid" : "dashed" },
          areaStyle: { opacity: 0.09 },
          markLine: {
            silent: true,
            symbol: "none",
            data: [
              { yAxis: config.warning, lineStyle: { color: styles.getPropertyValue("--warning").trim(), type: "dashed" }, label: { formatter: `管理值 ${config.warning} mm`, color: styles.getPropertyValue("--warning").trim() } },
              { yAxis: config.critical, lineStyle: { color: styles.getPropertyValue("--danger").trim(), type: "dashed" }, label: { formatter: `維修值 ${config.critical} mm`, color: styles.getPropertyValue("--danger").trim() } },
            ],
          },
        }],
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
  }, [reading, code, config, expanded]);

  return <div className={`wear-history-chart ${expanded ? "expanded" : ""}`} ref={chartRoot} role="img" aria-label={`${code}${config.measurement}最近七次歷史趨勢圖`} />;
}

export default function WearOverviewPage({ mode = "tread" }: { mode?: WearMode }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const expandedMapRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const dragRef = useRef({ pointerId: -1, startX: 0, startY: 0, originX: 0, originY: 0 });
  const clockBaselineRef = useRef<{ serverEpochMs: number; performanceMs: number } | null>(null);
  const [mapSize, setMapSize] = useState({ width: 1200, height: 700 });
  const [expandedMapSize, setExpandedMapSize] = useState({ width: 1500, height: 760 });
  const [selectedDirection, setSelectedDirection] = useState<Direction>("up");
  const [selectedPointNumber, setSelectedPointNumber] = useState(5);
  const [selectedRailSide, setSelectedRailSide] = useState<RailSide>("left");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isChartExpanded, setIsChartExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [mapViewport, setMapViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [currentEpochMs, setCurrentEpochMs] = useState<number | null>(null);
  const [clockSyncState, setClockSyncState] = useState<ClockSyncState>("syncing");
  const config = wearModeConfig[mode];
  const monitorPoints = mode === "side" ? [...sideUpMonitorPoints, ...sideDownMonitorPoints] : [...treadUpMonitorPoints, ...treadDownMonitorPoints];
  const getWearStatus = (wear: number) => wearStatus(wear, mode);

  useEffect(() => {
    let disposed = false;
    const updateClock = () => {
      const baseline = clockBaselineRef.current;
      if (!disposed && baseline) setCurrentEpochMs(baseline.serverEpochMs + performance.now() - baseline.performanceMs);
    };
    const synchronizeClock = async () => {
      const requestStartedAt = performance.now();
      try {
        const response = await fetch("/api/time", { cache: "no-store" });
        if (!response.ok) throw new Error("time sync failed");
        const payload = await response.json() as { now?: string };
        const serverEpochMs = Date.parse(payload.now ?? "");
        if (!Number.isFinite(serverEpochMs)) throw new Error("invalid server time");
        const receivedAt = performance.now();
        clockBaselineRef.current = {
          serverEpochMs: serverEpochMs + (receivedAt - requestStartedAt) / 2,
          performanceMs: receivedAt,
        };
        if (!disposed) setClockSyncState("cloudflare");
      } catch {
        const performanceMs = performance.now();
        clockBaselineRef.current = { serverEpochMs: Date.now(), performanceMs };
        if (!disposed) setClockSyncState("fallback");
      }
      updateClock();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void synchronizeClock();
    };
    void synchronizeClock();
    const tickTimer = window.setInterval(updateClock, 30_000);
    const syncTimer = window.setInterval(() => void synchronizeClock(), 300_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(tickTimer);
      window.clearInterval(syncTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const update = () => setMapSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    const element = expandedMapRef.current;
    if (!element) return;
    const update = () => setExpandedMapSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setIsExpanded(false);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      observer.disconnect();
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!isChartExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setIsChartExpanded(false);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isChartExpanded]);

  const layout = useMemo(() => calculateRouteLayout(mapSize.width, mapSize.height), [mapSize]);
  const expandedLayout = useMemo(() => calculateRouteLayout(expandedMapSize.width, expandedMapSize.height), [expandedMapSize]);
  const selectedPoint = monitorPoints.find((point) => point.direction === selectedDirection && point.number === selectedPointNumber) ?? monitorPoints[4];
  const selectedReading = selectedPoint.readings[selectedRailSide];
  const selectedCode = railCode(selectedPoint.number, selectedRailSide);
  const selectedDisplayCode = `${directionText[selectedPoint.direction]} ${selectedCode}`;
  const selectedStatus = getWearStatus(selectedReading.wear);
  const selectedPrediction = predictWearTrend(selectedReading.history, config.warning, config.critical);
  const currentProjection = currentEpochMs === null ? null : projectWearAtTime(selectedPrediction, currentEpochMs);
  const currentEstimatedWear = currentProjection?.wear ?? selectedReading.wear;
  const currentEstimatedStatus = getWearStatus(currentEstimatedWear);
  const currentTaipeiTime = currentEpochMs === null ? "時間同步中…" : formatTaipeiDateTime(currentEpochMs);
  const clockSourceText = clockSyncState === "cloudflare" ? "Cloudflare 時間同步" : clockSyncState === "fallback" ? "裝置時間備援" : "正在向 Cloudflare 同步";
  const allRails = monitorPoints.flatMap((point) => [point.readings.left, point.readings.right]);
  const criticalCount = allRails.filter((reading) => getWearStatus(reading.wear) === "critical").length;
  const warningCount = allRails.filter((reading) => getWearStatus(reading.wear) === "warning").length;
  const normalCount = allRails.length - criticalCount - warningCount;
  const criticalRails = monitorPoints
    .flatMap((point) => (["left", "right"] as RailSide[]).map((side) => ({ point, side, reading: point.readings[side] })))
    .filter(({ reading }) => getWearStatus(reading.wear) === "critical")
    .sort((a, b) => b.reading.wear - a.reading.wear);

  const selectRail = (point: MonitorPoint, side: RailSide) => {
    setSelectedDirection(point.direction);
    setSelectedPointNumber(point.number);
    setSelectedRailSide(side);
  };

  const locateRailOnMap = (point: MonitorPoint, side: RailSide) => {
    selectRail(point, side);
    setDirectionFilter(point.direction);
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      workspaceRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  };

  const selectDirectionFilter = (filter: DirectionFilter) => {
    setDirectionFilter(filter);
    if (filter !== "all" && filter !== selectedDirection) {
      const sameNumber = monitorPoints.find((point) => point.direction === filter && point.number === selectedPointNumber);
      const fallback = monitorPoints.find((point) => point.direction === filter);
      setSelectedDirection(filter);
      setSelectedPointNumber((sameNumber ?? fallback)?.number ?? 1);
    }
  };

  const stationStatus = (station: Station) => {
    const adjacent = monitorPoints.filter((point) => point.from.id === station.id || point.to.id === station.id);
    if (!adjacent.length) return "unknown";
    return worstStatus(adjacent.flatMap((point) => [getWearStatus(point.readings.left.wear), getWearStatus(point.readings.right.wear)]));
  };

  const renderTopology = (activeLayout: RouteLayout) => (
    <>
      {routeSegments.map((segment) => {
        const geometry = activeLayout.segmentGeometry[segment.id];
        const active = selectedPoint.segmentId === segment.id;
        const renderLane = (direction: Direction, side: RailSide) => {
          const segmentPoints = monitorPoints
            .filter((point) => point.segmentId === segment.id && point.direction === direction)
            .sort((a, b) => b.number - a.number);
          const filteredOut = directionFilter !== "all" && directionFilter !== direction;
          if (!segmentPoints.length) return <span className={`fallback-track unknown ${filteredOut ? "filtered-out" : ""}`} aria-hidden="true"></span>;
          return segmentPoints.map((point) => {
            const reading = point.readings[side];
            const code = railCode(point.number, side);
            const mapCode = mapRailCode(direction, point.number, side);
            const selected = selectedDirection === direction && selectedPointNumber === point.number && selectedRailSide === side;
            return (
              <button
                type="button"
                key={railKey(direction, point.number, side)}
                className={`device-track ${getWearStatus(reading.wear)} ${selected ? "selected" : ""} ${filteredOut ? "filtered-out" : ""}`}
                onClick={(event) => { event.stopPropagation(); selectRail(point, side); }}
                aria-pressed={selected}
                title={`${directionText[direction]} ${code}｜${sideText[side]}｜${config.measurement} ${reading.wear} mm｜${statusText[getWearStatus(reading.wear)]}`}
                aria-label={`${directionText[direction]} ${code}，${sideText[side]}，${config.measurement} ${reading.wear} 毫米，${statusText[getWearStatus(reading.wear)]}`}
              >
                <span className={`device-track-label wear-label-${direction}-${side}`} style={{ transform: `translateX(-50%) rotate(${-geometry.angle}deg)` }}>{mapCode}</span>
              </button>
            );
          });
        };
        return (
          <div
            className={`map-segment-group wear-segment-group ${active ? "selected" : ""}`}
            key={segment.id}
            style={{ left: `${geometry.x.toFixed(2)}px`, top: `${geometry.y.toFixed(2)}px`, width: `${geometry.length.toFixed(2)}px`, transform: `translateY(-50%) rotate(${geometry.angle}deg)` }}
          >
            <div className="track-lane wear-lane-up-right">{renderLane("up", "right")}</div>
            <div className="track-lane wear-lane-up-left">{renderLane("up", "left")}</div>
            <div className="track-lane wear-lane-down-left">{renderLane("down", "left")}</div>
            <div className="track-lane wear-lane-down-right">{renderLane("down", "right")}</div>
          </div>
        );
      })}

      {wearStations.map((station, stationIndex) => {
        const point = activeLayout.stationPoints[station.id];
        const previousPoint = stationIndex > 0
          ? activeLayout.stationPoints[wearStations[stationIndex - 1].id]
          : point;
        const nextPoint = stationIndex < wearStations.length - 1
          ? activeLayout.stationPoints[wearStations[stationIndex + 1].id]
          : point;
        const railAngle = Math.atan2(nextPoint.y - previousPoint.y, nextPoint.x - previousPoint.x) * 180 / Math.PI;
        const stationStyle = {
          left: `${point.x.toFixed(2)}px`,
          top: `${point.y.toFixed(2)}px`,
          "--station-cross-angle": `${railAngle + 90}deg`,
          "--station-text-angle": `${-(railAngle + 90)}deg`,
        } as CSSProperties;
        const active = selectedPoint.from.id === station.id || selectedPoint.to.id === station.id;
        return (
          <div className={`map-station station-${station.id.toLowerCase()} label-${point.labelSide} ${active ? "selected" : ""}`} key={station.id} style={stationStyle}>
            <span className="station-node"><em>{station.id}</em></span>
            <span className="station-label"><strong>{station.name}</strong><small>{station.id}</small></span>
            <i className={`station-state ${stationStatus(station)}`}></i>
          </div>
        );
      })}

      <div className="wear-direction-end-labels" aria-label="路線兩端上行與下行方向提示">
          <span
            className="wear-direction-end-label terminal-y19 down"
            style={{ left: `${activeLayout.stationPoints.Y19.x - 48}px`, top: `${activeLayout.stationPoints.Y19.y - 42}px` }}
          ><i></i>下行</span>
          <span
            className="wear-direction-end-label terminal-y19 up"
            style={{ left: `${activeLayout.stationPoints.Y19.x + 48}px`, top: `${activeLayout.stationPoints.Y19.y - 42}px` }}
          ><i></i>上行</span>
          <span
            className="wear-direction-end-label terminal-y6 up"
            style={{ left: `${activeLayout.stationPoints.Y6.x + 128}px`, top: `${activeLayout.stationPoints.Y6.y - 38}px` }}
          ><i></i>上行</span>
          <span
            className="wear-direction-end-label terminal-y6 down"
            style={{ left: `${activeLayout.stationPoints.Y6.x + 128}px`, top: `${activeLayout.stationPoints.Y6.y + 38}px` }}
          ><i></i>下行</span>
      </div>

    </>
  );

  const clampScale = (scale: number) => Math.min(3, Math.max(0.65, scale));
  const zoomMap = (change: number) => setMapViewport((current) => ({ ...current, scale: clampScale(current.scale + change) }));
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setMapViewport((current) => ({ ...current, scale: clampScale(current.scale * (event.deltaY < 0 ? 1.12 : 0.89)) }));
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: mapViewport.x, originY: mapViewport.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    setMapViewport((current) => ({ ...current, x: dragRef.current.originX + event.clientX - dragRef.current.startX, y: dragRef.current.originY + event.clientY - dragRef.current.startY }));
  };
  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current.pointerId = -1;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const renderSelectedRailMapCard = (expanded = false) => (
    <aside
      key={railKey(selectedPoint.direction, selectedPoint.number, selectedRailSide)}
      className={`selected-rail-map-card ${expanded ? "expanded" : ""}`}
      aria-live="polite"
      aria-label={`目前選取${directionText[selectedPoint.direction]}${selectedCode}，${selectedPoint.from.name}至${selectedPoint.to.name}`}
    >
      <header>
        <p>目前選取軌道</p>
        <div>
          <strong>{selectedCode}</strong>
          <span className={`selected-map-status ${selectedStatus}`}>{statusText[selectedStatus]}</span>
        </div>
        <small>監測點 {selectedPoint.number} · {config.measurement}</small>
      </header>
      <dl>
        <div><dt>方向</dt><dd>{directionText[selectedPoint.direction]}</dd></div>
        <div><dt>軌別</dt><dd>{sideText[selectedRailSide]}</dd></div>
        <div className="selected-map-location"><dt>站間</dt><dd><span>{selectedPoint.from.id} {selectedPoint.from.name}</span><i>→</i><span>{selectedPoint.to.id} {selectedPoint.to.name}</span></dd></div>
        <div><dt>量測</dt><dd>{selectedReading.wear.toFixed(2)} mm</dd></div>
        <div><dt>狀態</dt><dd className={selectedStatus}>{statusText[selectedStatus]}</dd></div>
      </dl>
    </aside>
  );

  return (
    <main className={`app-shell wear-page ${mode === "side" ? "side-wear-page" : "tread-wear-page"}`}>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark wear-brand-mark" aria-hidden="true"><span></span><span></span></div>
          <div><p className="eyebrow">NEW TAIPEI METRO · O&amp;M</p><h1>環狀線鋼軌狀態監測中心</h1></div>
        </div>
        <nav className="topnav" aria-label="主要功能">
          <a href="/" className="nav-item">潤滑設備總覽</a>
          <a href="/wear" className={`nav-item ${mode === "tread" ? "active" : ""}`} aria-current={mode === "tread" ? "page" : undefined}>正面軌道總覽</a>
          <a href="/side-wear" className={`nav-item ${mode === "side" ? "active" : ""}`} aria-current={mode === "side" ? "page" : undefined}>側面軌道總覽</a>
        </nav>
        <div className="sync-state"><span className="pulse-dot"></span>上／下行 · {config.measurement} · 門檻已設定</div>
      </header>

      <section className="page-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow dark">UP &amp; DOWN LINE · {config.englishTitle}</p>
            <h2>{config.title}</h2>
            <p>保留上行15個監測點，新增下行16個監測點；每個監測點皆分成左軌與右軌。</p>
          </div>
          <div className="updated-at wear-updated-at"><span>資料時間</span><strong>{currentTaipeiTime}</strong><small>Asia/Taipei · {clockSourceText}</small></div>
        </div>

        <section className="summary-grid wear-summary-grid" aria-label={`${config.title}摘要`}>
          <article className="summary-card danger-card"><span>達維修值軌道</span><strong>{criticalCount}</strong><small>{config.critical} mm 以上</small></article>
          <article className="summary-card warning-card"><span>達管理值軌道</span><strong>{warningCount}</strong><small>{config.warning} mm 以上、未達 {config.critical} mm</small></article>
          <article className="summary-card"><span>正常軌道</span><strong>{normalCount}</strong><small>低於 {config.warning} mm</small></article>
          <article className="summary-card"><span>監測軌道總數</span><strong>{allRails.length}</strong><small>上行15點＋下行16點 × 左右軌</small></article>
        </section>

        <section className="workspace-grid" ref={workspaceRef}>
          <article className="panel route-panel">
            <div className="panel-heading">
              <div><span className="panel-kicker">上行15點 · 下行16點 · 四軌獨立判定</span><h3>Y19 新北產業園區－Y6 大坪林</h3></div>
              <div className="map-heading-actions wear-map-actions">
                <div className="legend" aria-label="磨損狀態圖例">
                  <span><i className="legend-line normal"></i>正常</span>
                  <span><i className="legend-line warning"></i>管理值（黃）</span>
                  <span><i className="legend-line critical"></i>維修值（紅）</span>
                </div>
                <div className="direction-filter" role="group" aria-label="顯示上行或下行">
                  {(["all", "up", "down"] as DirectionFilter[]).map((filter) => (
                    <button type="button" key={filter} className={directionFilter === filter ? "active" : ""} onClick={() => selectDirectionFilter(filter)}>{filter === "all" ? "全部" : directionText[filter]}</button>
                  ))}
                </div>
                <button type="button" className="expand-map-button" onClick={() => { setMapViewport({ x: 0, y: 0, scale: 1 }); setIsExpanded(true); }} aria-haspopup="dialog"><i aria-hidden="true">⛶</i>放大地圖</button>
              </div>
            </div>

            <div className="topology-stage wear-topology-stage wear-four-track-stage" ref={mapRef} role="group" aria-label={`環狀線上行與下行${config.title}地圖`}>
              <div className="map-orientation"><span>北</span><i></i></div>
              {renderTopology(layout)}
              {renderSelectedRailMapCard()}
            </div>

            <div className="wear-route-footnote">
              <span><i className="wear-direction-sample up"></i>上行R</span>
              <span><i className="wear-direction-sample up"></i>上行L</span>
              <span><i className="wear-direction-sample down"></i>下行L</span>
              <span><i className="wear-direction-sample down"></i>下行R</span>
              <p>點擊任一條編號軌道，即可查看該監測點的磨損與歷史資料。</p>
            </div>

            <div className="wear-mobile-list" aria-label="手機版上行與下行監測點清單">
              {monitorPoints.map((point) => (
                <article key={`${point.direction}-${point.number}`} className={selectedDirection === point.direction && selectedPointNumber === point.number ? "selected" : ""}>
                  <strong>{directionText[point.direction]}監測點 {point.number} · {point.from.name}－{point.to.name}</strong>
                  <div>
                    {(["left", "right"] as RailSide[]).map((side) => (
                      <button key={side} type="button" className={getWearStatus(point.readings[side].wear)} onClick={() => selectRail(point, side)}>{mapRailCode(point.direction, point.number, side)} {point.readings[side].wear} mm</button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="panel wear-detail-panel">
            <div className="wear-detail-heading">
              <div><span className="panel-kicker">目前選取 · {directionText[selectedPoint.direction]}{sideText[selectedRailSide]} · {config.measurement}</span><h3>{selectedDisplayCode}｜監測點 {selectedPoint.number}｜{selectedPoint.from.id} {selectedPoint.from.name}－{selectedPoint.to.id} {selectedPoint.to.name}</h3></div>
              <span className={`status-pill ${selectedStatus}`}>{statusText[selectedStatus]}</span>
            </div>

            <div className="rail-direction-tabs" role="group" aria-label="選取左軌或右軌">
              {(["left", "right"] as RailSide[]).map((side) => (
                <button type="button" key={side} className={selectedRailSide === side ? "active" : ""} onClick={() => selectRail(selectedPoint, side)}><i className={`wear-direction-sample ${side === "left" ? "up" : "down"}`}></i>{railCode(selectedPoint.number, side)} {sideText[side]}</button>
              ))}
            </div>

            <div className="wear-reading-grid">
              <div><span>軌道編號</span><strong>{selectedDisplayCode}</strong></div>
              <div><span>{config.measurement}</span><strong>{selectedReading.wear.toFixed(2)} mm</strong></div>
              <div><span>Excel 項次</span><strong>{selectedPoint.number}</strong></div>
              <div><span>較前次增加</span><strong>+{selectedReading.change.toFixed(2)} mm</strong></div>
              <div><span>最近巡檢日期</span><strong>{selectedReading.inspectedAt}</strong></div>
              <div><span>維修值</span><strong>{config.critical.toFixed(1)} mm</strong></div>
            </div>

            <div className="wear-gauge-card">
              <div><strong>{selectedDisplayCode} {config.measurement}程度</strong><span>{Math.round(selectedReading.wear / config.scaleMax * 100)}%</span></div>
              <div className="wear-gauge" style={{ background: `linear-gradient(90deg, #dcf7ec 0 ${config.warning / config.scaleMax * 100}%, #fff3d7 ${config.warning / config.scaleMax * 100}% ${config.critical / config.scaleMax * 100}%, #ffe2e8 ${config.critical / config.scaleMax * 100}% 100%)` }}><i className={selectedStatus} style={{ width: `${Math.min(100, selectedReading.wear / config.scaleMax * 100)}%` }}></i><b className="management-marker" style={{ left: `${config.warning / config.scaleMax * 100}%` }}></b><b className="maintenance-marker" style={{ left: `${config.critical / config.scaleMax * 100}%` }}></b></div>
              <div className="wear-gauge-scale"><span>0 mm</span><span>管理值 {config.warning} mm</span><span>維修值 {config.critical} mm</span><span>{config.scaleMax} mm</span></div>
            </div>

            <aside className={`wear-maintenance-note ${selectedStatus}`}>
              <strong>{selectedStatus === "critical" ? "已達維修值，建議安排現場複查" : selectedStatus === "warning" ? "已達管理值，建議提高巡檢頻率" : "維持例行巡檢"}</strong>
              <p>{selectedStatus === "critical" ? `${selectedDisplayCode} 已達 ${config.critical} mm 維修值，請確認量測位置並安排研磨或更換評估。` : selectedStatus === "warning" ? `${selectedDisplayCode} 已達 ${config.warning} mm 管理值、尚未達維修值，建議觀察下次量測的增加速度。` : `${selectedDisplayCode} 目前低於 ${config.warning} mm 管理值，依原訂週期持續追蹤即可。`}</p>
            </aside>

            {mode === "tread" && (
              <section className={`wear-prediction-card confidence-${selectedPrediction.confidence}`} aria-label={`${selectedDisplayCode}當下磨耗狀況推估`}>
                <header>
                  <div><span className="panel-kicker">CURRENT ESTIMATE · SPARSE INSPECTION</span><h4>當下磨耗狀況推估</h4></div>
                  <span className="wear-prediction-confidence">趨勢信心 · {predictionConfidenceText[selectedPrediction.confidence]}</span>
                </header>
                <div className="wear-prediction-grid">
                  <div><span>穩健磨耗率</span><strong>+{selectedPrediction.ratePer30Days.toFixed(3)} mm／30天</strong><small>{selectedPrediction.sampleCount} 筆、跨 {selectedPrediction.observationSpanDays} 天</small></div>
                  <div><span>當下預估</span><strong>{currentProjection ? `${currentEstimatedWear.toFixed(2)} mm` : "同步中…"}</strong><small>{currentTaipeiTime}</small></div>
                  <div><span>距最近量測</span><strong>{currentProjection ? `${Math.floor(currentProjection.elapsedDays)} 天` : "同步中…"}</strong><small>最近量測 {selectedPrediction.latestDate}</small></div>
                  <div><span>當下判定</span><strong className={`wear-prediction-current-status ${currentEstimatedStatus}`}>{currentProjection ? statusText[currentEstimatedStatus] : "同步中…"}</strong><small>{currentProjection ? currentEstimatedStatus === "critical" ? `已達 ${config.critical} mm 維修值` : currentEstimatedStatus === "warning" ? `已達 ${config.warning} mm 管理值` : `低於 ${config.warning} mm 管理值` : "等待目前時間"}</small></div>
                </div>
                <footer>
                  <span><strong>當下推估範圍</strong> {currentProjection ? currentProjection.withinReliableHorizon ? "仍在可信範圍" : "已超出可信範圍" : "同步中…"}</span>
                  <p>從最近量測日推估至 Cloudflare 同步的台北現在時間；當下推估不能取代現場巡檢與正式維修判定。</p>
                </footer>
              </section>
            )}
          </article>

          <article className="panel wear-history-panel">
            <div className="wear-history-heading">
              <div><span className="panel-kicker">歷史資料 · 隨目前軌道自動更新</span><h3>{selectedDisplayCode} · {selectedPoint.from.name}－{selectedPoint.to.name}</h3><p>顯示{directionText[selectedPoint.direction]}{sideText[selectedRailSide]}最近七次{config.measurement}趨勢。</p></div>
              <button type="button" className="expand-chart-button" onClick={() => setIsChartExpanded(true)} aria-haspopup="dialog"><i aria-hidden="true">⛶</i>放大圖表</button>
            </div>
            <WearHistoryChart reading={selectedReading} code={selectedDisplayCode} config={config} />
            <div className="wear-history-table-shell">
              <table className="wear-history-table">
                <caption>{selectedDisplayCode} {sideText[selectedRailSide]}逐次量測紀錄（示範資料）</caption>
                <thead><tr><th scope="col">量測日期</th><th scope="col">軌道編號</th><th scope="col">{config.measurement}</th><th scope="col">較前次</th><th scope="col">狀態</th><th scope="col">資料來源</th></tr></thead>
                <tbody>
                  {[...selectedReading.history].reverse().map((point) => {
                    const pointStatus = getWearStatus(point.wear);
                    return <tr key={point.date}><td>{point.date}</td><td><strong>{selectedDisplayCode}</strong></td><td><strong>{point.wear.toFixed(2)} mm</strong></td><td className={point.change > 0 ? "wear-increase" : ""}>{point.change === 0 ? "起始" : `+${point.change.toFixed(2)} mm`}</td><td><span className={`wear-history-status ${pointStatus}`}>{statusText[pointStatus]}</span></td><td>{point.method}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <section className="panel alerts-panel wear-alerts-panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">紅色異常清單 · {config.measurement}</span><h3>優先處理軌道</h3></div>
            <span className="alerts-count">{criticalRails.length} 條軌道達維修值</span>
          </div>
          <div className="alerts-table" role="table" aria-label={`${config.measurement}紅色異常軌道清單`}>
            <div className="table-row table-head" role="row"><span>軌道</span><span>目前磨耗量</span><span>軌道位置</span><span>相比前次</span><span>操作</span></div>
            {criticalRails.map(({ point, side, reading }) => {
              const code = `${directionText[point.direction]} ${railCode(point.number, side)}`;
              return (
                <div className="table-row" role="row" key={railKey(point.direction, point.number, side)}>
                  <strong>{code}</strong>
                  <span><b className="danger-text">{reading.wear.toFixed(2)} mm</b></span>
                  <span>{point.from.id} {point.from.name}－{point.to.id} {point.to.name}</span>
                  <span className="danger-text">+{reading.change.toFixed(2)} mm</span>
                  <button type="button" className="table-action" onClick={() => locateRailOnMap(point, side)}>在圖上定位</button>
                </div>
              );
            })}
            {!criticalRails.length && <div className="wear-alerts-empty">目前沒有達到紅色維修值的軌道。</div>}
          </div>
        </section>
      </section>

      {isExpanded && (
        <div className="map-modal-backdrop" role="presentation">
          <section className="map-modal wear-map-modal" role="dialog" aria-modal="true" aria-labelledby="wear-map-modal-title">
            <header className="map-modal-header"><div><span className="panel-kicker">上行／下行 · {config.title}</span><h3 id="wear-map-modal-title">拖曳與縮放查看四條軌道</h3><p>由上到下為上行R、上行L、下行L、下行R；點擊後可查看詳細資料。</p></div><button type="button" className="chart-modal-close" onClick={() => setIsExpanded(false)} aria-label="關閉放大地圖">×</button></header>
            <div className="map-modal-viewport-shell">
              <div className={`map-modal-viewport ${isDragging ? "dragging" : ""}`} ref={expandedMapRef} onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd}>
                <div className="map-pan-layer" style={{ transform: `translate(${mapViewport.x}px, ${mapViewport.y}px) scale(${mapViewport.scale})` }}>{renderTopology(expandedLayout)}</div>
                {renderSelectedRailMapCard(true)}
                <div className="map-zoom-controls"><button type="button" onClick={() => zoomMap(0.2)} aria-label="放大">＋</button><button type="button" onClick={() => zoomMap(-0.2)} aria-label="縮小">−</button><output>{Math.round(mapViewport.scale * 100)}%</output><button type="button" className="reset-map-view" onClick={() => setMapViewport({ x: 0, y: 0, scale: 1 })}>重設</button></div>
                <div className="map-drag-hint"><span>↔</span>拖曳移動 · 滾輪縮放</div>
              </div>
            </div>
          </section>
        </div>
      )}

      {isChartExpanded && (
        <div className="chart-modal-backdrop" role="presentation">
          <section className="chart-modal" role="dialog" aria-modal="true" aria-labelledby="wear-history-modal-title">
            <header className="chart-modal-header"><div><span className="panel-kicker">{directionText[selectedPoint.direction]} · {config.title} · {selectedCode}</span><h3 id="wear-history-modal-title">{selectedPoint.from.name}－{selectedPoint.to.name}歷史趨勢</h3></div><button type="button" className="chart-modal-close" onClick={() => setIsChartExpanded(false)} aria-label="關閉放大圖表">×</button></header>
            <div className="chart-modal-devices"><span style={{ "--series-color": selectedRailSide === "left" ? "#0fa878" : "#e59a14" } as CSSProperties}><i></i><strong>{selectedDisplayCode} {sideText[selectedRailSide]}</strong> {selectedReading.wear.toFixed(2)} mm</span><small>單位：mm · 黃色為管理值 · 紅色為維修值</small></div>
            <div className="chart-modal-canvas"><WearHistoryChart reading={selectedReading} code={selectedDisplayCode} config={config} expanded /></div>
          </section>
        </div>
      )}
    </main>
  );
}
