"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type RailStatus = "normal" | "warning" | "critical" | "unknown";
type Direction = "up" | "down";
type LabelSide = "right" | "bottom" | "corner";

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

function makeDevice(
  id: string,
  direction: Direction,
  status: RailStatus,
  value: number,
  change: number,
  history: number[],
): Device {
  return { id, direction, status, value, change, history };
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
      makeDevice("MOK3", "up", "critical", 14, -7, [61, 55, 49, 41, 32, 21, 14]),
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

function stationStatus(stationIndex: number) {
  const adjacent = segments.filter((segment) => segment.from === stationIndex || segment.to === stationIndex);
  return worstStatus(adjacent.map(segmentStatus));
}

function formatChange(change: number) {
  if (change === 0) return "無變動";
  return `${change > 0 ? "+" : ""}${change} L`;
}

function calculateRouteLayout(width: number, height: number): RouteLayout {
  const safeWidth = Math.max(width, 760);
  const safeHeight = Math.max(height, 560);
  const padding = { left: 118, right: 138, top: 74, bottom: 112 };
  const verticalAvailable = Math.max(300, safeHeight - padding.top - padding.bottom);
  const horizontalAvailable = Math.max(420, safeWidth - padding.left - padding.right);
  const weights = routeSegments.map(segmentWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let bestBendIndex = 5;
  let bestUnit = 0;
  let cumulativeWeight = 0;

  for (let index = 1; index < routeSegments.length - 1; index += 1) {
    cumulativeWeight += weights[index - 1];
    const remainingWeight = totalWeight - cumulativeWeight;
    const candidateUnit = Math.min(
      verticalAvailable / cumulativeWeight,
      horizontalAvailable / remainingWeight,
    );
    if (candidateUnit > bestUnit) {
      bestUnit = candidateUnit;
      bestBendIndex = index;
    }
  }

  const verticalWeight = weights.slice(0, bestBendIndex).reduce((sum, weight) => sum + weight, 0);
  const horizontalWeight = totalWeight - verticalWeight;
  const verticalLength = verticalWeight * bestUnit;
  const horizontalLength = horizontalWeight * bestUnit;
  const startX = padding.left + Math.max(0, (horizontalAvailable - horizontalLength) / 2);
  const startY = padding.top + Math.max(0, (verticalAvailable - verticalLength) / 2);

  const stationPoints: Record<string, Point> = {};
  const segmentGeometry: Record<string, SegmentGeometry> = {};
  let x = startX;
  let y = startY;

  stationPoints[routeStations[0].id] = { x, y, labelSide: "right" };

  routeSegments.forEach((segment, index) => {
    const length = weights[index] * bestUnit;
    const isVertical = index < bestBendIndex;
    const angle = isVertical ? 90 : 0;
    segmentGeometry[segment.id] = { x, y, length, angle };

    if (isVertical) y += length;
    else x += length;

    const nextStation = routeStations[index + 1];
    stationPoints[nextStation.id] = {
      x,
      y,
      labelSide: index + 1 === bestBendIndex ? "corner" : isVertical ? "right" : "bottom",
    };
  });

  return {
    stationPoints,
    segmentGeometry,
    bendStation: routeStations[bestBendIndex].id,
    unit: bestUnit,
    totalWeight,
  };
}

function HistoryChart({ device }: { device: Device }) {
  const chartRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let chart: { dispose: () => void; resize: () => void } | undefined;

    void import("echarts").then((echarts) => {
      if (disposed || !chartRoot.current) return;
      const styles = getComputedStyle(document.documentElement);
      const colorMap: Record<RailStatus, string> = {
        normal: styles.getPropertyValue("--success").trim(),
        warning: styles.getPropertyValue("--warning").trim(),
        critical: styles.getPropertyValue("--danger").trim(),
        unknown: styles.getPropertyValue("--muted").trim(),
      };
      const instance = echarts.init(chartRoot.current);
      chart = instance;
      instance.setOption({
        animationDuration: 420,
        grid: { left: 43, right: 12, top: 28, bottom: 30 },
        tooltip: { trigger: "axis", valueFormatter: (value: unknown) => `${value} L` },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: ["7/18", "7/19", "7/20", "7/21", "7/22", "7/23", "7/24"],
          axisLine: { lineStyle: { color: styles.getPropertyValue("--line").trim() } },
          axisLabel: { color: styles.getPropertyValue("--muted").trim(), fontSize: 11 },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          min: 0,
          max: 80,
          splitNumber: 4,
          axisLabel: { color: styles.getPropertyValue("--muted").trim(), formatter: "{value} L", fontSize: 11 },
          splitLine: { lineStyle: { color: styles.getPropertyValue("--line").trim() } },
        },
        series: [{
          name: device.id,
          type: "line",
          smooth: 0.35,
          symbolSize: 8,
          data: device.history,
          lineStyle: { width: 3, color: colorMap[device.status] },
          itemStyle: { color: colorMap[device.status] },
          areaStyle: { color: colorMap[device.status], opacity: 0.11 },
          markLine: {
            silent: true,
            symbol: "none",
            label: { formatter: "警戒 20 L", color: styles.getPropertyValue("--danger").trim() },
            lineStyle: { color: styles.getPropertyValue("--danger").trim(), type: "dashed" },
            data: [{ yAxis: 20 }],
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
  }, [device]);

  return <div className="history-chart" ref={chartRoot} role="img" aria-label={`${device.id} 最近七次油量歷史折線圖`} />;
}

export default function Home() {
  const topologyRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState({ width: 1000, height: 680 });
  const [selectedSegmentId, setSelectedSegmentId] = useState("Y10-Y11");
  const [selectedDeviceId, setSelectedDeviceId] = useState("LB4");

  useEffect(() => {
    const element = topologyRef.current;
    if (!element) return;
    const updateSize = () => setMapSize({ width: element.clientWidth, height: element.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => calculateRouteLayout(mapSize.width, mapSize.height), [mapSize]);
  const selectedSegment = useMemo(
    () => segments.find((segment) => segment.id === selectedSegmentId) ?? segments[4],
    [selectedSegmentId],
  );
  const selectedDevice = useMemo(
    () => selectedSegment.devices.find((device) => device.id === selectedDeviceId) ?? null,
    [selectedDeviceId, selectedSegment],
  );
  const selectedSegmentState = segmentStatus(selectedSegment);
  const upDevices = devicesByDirection(selectedSegment, "up");
  const downDevices = devicesByDirection(selectedSegment, "down");

  const allDeviceRecords = useMemo(() => segments.flatMap((segment) => (
    segment.devices.map((device) => ({ device, segment }))
  )), []);
  const alerts = useMemo(() => allDeviceRecords
    .filter(({ device }) => device.status === "critical" || device.status === "warning")
    .sort((a, b) => statusPriority[b.device.status] - statusPriority[a.device.status] || a.device.value - b.device.value)
    .slice(0, 6), [allDeviceRecords]);
  const criticalCount = allDeviceRecords.filter(({ device }) => device.status === "critical").length;
  const warningCount = allDeviceRecords.filter(({ device }) => device.status === "warning").length;

  const chooseDefaultDevice = (segment: Segment) => {
    return [...segment.devices].sort((a, b) => (
      statusPriority[b.status] - statusPriority[a.status] || a.value - b.value
    ))[0] ?? null;
  };

  const selectSegment = (segment: Segment) => {
    setSelectedSegmentId(segment.id);
    setSelectedDeviceId(chooseDefaultDevice(segment)?.id ?? "");
  };

  const selectDevice = (segment: Segment, device: Device) => {
    setSelectedSegmentId(segment.id);
    setSelectedDeviceId(device.id);
  };

  const renderDeviceLane = (segment: Segment, direction: Direction, angle: number) => {
    const laneDevices = devicesByDirection(segment, direction);
    const fallback = direction === "up" ? segment.fallbackUp : segment.fallbackDown;
    if (!laneDevices.length) {
      return <span className={`fallback-track ${fallback}`} aria-hidden="true"></span>;
    }
    return laneDevices.map((device) => (
      <button
        type="button"
        key={device.id}
        className={`device-track ${device.status} ${selectedDeviceId === device.id ? "selected" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          selectDevice(segment, device);
        }}
        title={`${device.id}｜${statusText[device.status]}｜${device.value} L`}
        aria-label={`${device.id}，${statusText[device.status]}，目前 ${device.value} L`}
      >
        <span
          className={`device-track-label label-${direction}`}
          style={{ transform: `translateX(-50%) rotate(${-angle}deg)` }}
        >{device.id}</span>
      </button>
    ));
  };

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
          <button type="button" className="nav-item active">全線總覽</button>
          <button type="button" className="nav-item">潤滑設備</button>
          <button type="button" className="nav-item">磨耗紀錄</button>
        </nav>
        <div className="sync-state"><span className="pulse-dot"></span>UI 草圖 · 模擬資料</div>
      </header>

      <section className="page-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow dark">LINE CONDITION OVERVIEW</p>
            <h2>從軌道線段直接定位設備</h2>
            <p>區間長度依設備數量自動配置；點選 MOK／LB 小線段，右側顯示該設備唯一一張歷史曲線。</p>
          </div>
          <div className="updated-at">資料時間 <strong>2026-07-24 16:30</strong></div>
        </div>

        <section className="summary-grid" aria-label="全線摘要">
          <article className="summary-card danger-card"><span>需處理設備</span><strong>{criticalCount}</strong><small>優先安排現場複查</small></article>
          <article className="summary-card warning-card"><span>注意設備</span><strong>{warningCount}</strong><small>持續觀察下降趨勢</small></article>
          <article className="summary-card"><span>固定潤滑設備</span><strong>20</strong><small>MOK 10 · LB 10</small></article>
          <article className="summary-card"><span>設備涵蓋區間</span><strong>5/13</strong><small>無設備資料不等於正常</small></article>
        </section>

        <section className="workspace-grid">
          <article className="panel route-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">設備權重 L 型拓撲</span>
                <h3>Y19 新北產業園區－Y6 大坪林</h3>
              </div>
              <div className="legend" aria-label="軌道狀態圖例">
                <span><i className="legend-line normal"></i>正常</span>
                <span><i className="legend-line warning"></i>注意</span>
                <span><i className="legend-line critical"></i>需處理</span>
                <span><i className="legend-line unknown"></i>尚無資料</span>
              </div>
            </div>

            <div className="topology-stage" ref={topologyRef} role="group" aria-label="環狀線 Y19 至 Y6 設備權重 L 型軌道圖">
              <div className="map-orientation"><span>北</span><i></i></div>
              <span className="map-zone zone-north">新莊</span>
              <span className="map-zone zone-center">板橋</span>
              <span className="map-zone zone-south">中和 · 新店</span>

              {segments.map((segment) => {
                const geometry = layout.segmentGeometry[segment.id];
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
                      aria-label={`查看 ${stations[segment.from].name}到${stations[segment.to].name}全部設備`}
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
                const point = layout.stationPoints[station.id];
                if (!point) return null;
                const active = selectedSegment.from === index || selectedSegment.to === index;
                const state = stationStatus(index);
                return (
                  <div
                    className={`map-station label-${point.labelSide} ${active ? "selected" : ""}`}
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
            </div>

            <div className="mobile-route-list" aria-label="環狀線行動版設備列表">
              {routeStations.map((station, routeIndex) => {
                const nextSegment = routeSegments[routeIndex];
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
                              className={`${device.status} ${selectedDeviceId === device.id ? "selected" : ""}`}
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
              <p>W = 1 + 0.75X｜總權重 {layout.totalWeight.toFixed(1)}｜1 單位約 {layout.unit.toFixed(0)}px｜轉彎站 {layout.bendStation}</p>
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
                <small>點設備切換下方圖表</small>
              </div>

              {selectedSegment.devices.length ? (
                <>
                  <div className="device-direction-group">
                    <div className="device-direction-title"><span className="direction-mark up"></span><strong>MOK 上行</strong><small>{statusText[directionStatus(selectedSegment, "up")]}</small></div>
                    <div className="device-card-grid">
                      {upDevices.map((device) => (
                        <button
                          type="button"
                          key={device.id}
                          className={`device-card ${device.status} ${selectedDeviceId === device.id ? "selected" : ""}`}
                          onClick={() => selectDevice(selectedSegment, device)}
                        >
                          <span><i></i>{device.id}</span><strong>{device.value} L</strong><small>{formatChange(device.change)}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="device-direction-group">
                    <div className="device-direction-title"><span className="direction-mark down"></span><strong>LB 下行</strong><small>{statusText[directionStatus(selectedSegment, "down")]}</small></div>
                    <div className="device-card-grid">
                      {downDevices.map((device) => (
                        <button
                          type="button"
                          key={device.id}
                          className={`device-card ${device.status} ${selectedDeviceId === device.id ? "selected" : ""}`}
                          onClick={() => selectDevice(selectedSegment, device)}
                        >
                          <span><i></i>{device.id}</span><strong>{device.value} L</strong><small>{formatChange(device.change)}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="no-device-message"><strong>此區間尚無固定設備資料</strong><span>無資料不能判定為正常。</span></div>
              )}
            </section>

            {selectedDevice ? (
              <section className="selected-device-detail">
                <div className="selected-device-heading">
                  <div>
                    <span className="panel-kicker">目前顯示設備</span>
                    <h4>{selectedDevice.id}</h4>
                  </div>
                  <span className={`status-pill ${selectedDevice.status}`}>{statusText[selectedDevice.status]}</span>
                </div>
                <div className="device-reading-grid">
                  <div><span>目前油量</span><strong>{selectedDevice.value} L</strong></div>
                  <div><span>相比前次</span><strong className={selectedDevice.change < 0 ? "danger-text" : ""}>{formatChange(selectedDevice.change)}</strong></div>
                  <div><span>所在軌道</span><strong>{selectedDevice.direction === "up" ? "MOK 上行" : "LB 下行"}</strong></div>
                </div>
                <div className="chart-heading"><strong>{selectedDevice.id} 最近七次油量趨勢</strong><span>單位：L</span></div>
                <HistoryChart device={selectedDevice} />
                <div className={`detail-note ${selectedDevice.status}`}>
                  <strong>維修提示</strong>
                  <p>{selectedDevice.status === "critical" ? "請優先核對現場油量、噴塗週期與最近一次補充紀錄。" : selectedDevice.status === "warning" ? "目前接近警戒值，請持續觀察下降速度並安排複查。" : "設備目前正常，持續依既定週期監測。"}</p>
                </div>
                <button type="button" className="primary-action">開啟 {selectedDevice.id} 完整設備紀錄</button>
              </section>
            ) : (
              <div className="chart-empty-state"><strong>尚未選取設備</strong><span>請點擊地圖上的 MOK／LB 小線段。</span></div>
            )}
          </aside>
        </section>

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
                <button type="button" className="table-action" onClick={() => selectDevice(segment, device)}>在圖上定位</button>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
