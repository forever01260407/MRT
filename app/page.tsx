"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type RailStatus = "normal" | "warning" | "critical" | "unknown";

type Station = {
  id: string;
  name: string;
};

type Segment = {
  id: string;
  from: number;
  to: number;
  up: RailStatus;
  down: RailStatus;
  assets: string;
  reading: string;
  location: string;
  history: number[];
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

const segments: Segment[] = [
  { id: "Y6-Y7", from: 0, to: 1, up: "unknown", down: "unknown", assets: "尚無設備資料", reading: "待建立監測點", location: "大坪林－十四張", history: [0, 0, 0, 0, 0, 0, 0] },
  { id: "Y7-Y8", from: 1, to: 2, up: "warning", down: "normal", assets: "MOK1 · LB1", reading: "MOK1 目前 19 L", location: "十四張往秀朗橋方向", history: [57, 52, 45, 37, 31, 25, 19] },
  { id: "Y8-Y9", from: 2, to: 3, up: "normal", down: "normal", assets: "尚無固定設備", reading: "最近巡檢正常", location: "秀朗橋－景平", history: [66, 64, 65, 61, 62, 60, 59] },
  { id: "Y9-Y10", from: 3, to: 4, up: "normal", down: "normal", assets: "尚無固定設備", reading: "最近巡檢正常", location: "景平－景安", history: [69, 67, 66, 63, 64, 61, 60] },
  { id: "Y10-Y11", from: 4, to: 5, up: "critical", down: "normal", assets: "MOK2–5 · LB2–5", reading: "MOK5 目前 17 L", location: "景安往中和方向", history: [68, 59, 52, 43, 35, 27, 17] },
  { id: "Y11-Y12", from: 5, to: 6, up: "normal", down: "normal", assets: "MOK6 · LB6", reading: "LB6 目前 49 L", location: "中和－橋和", history: [72, 68, 65, 61, 58, 54, 49] },
  { id: "Y12-Y13", from: 6, to: 7, up: "unknown", down: "unknown", assets: "尚無設備資料", reading: "待建立監測點", location: "橋和－中原", history: [0, 0, 0, 0, 0, 0, 0] },
  { id: "Y13-Y14", from: 7, to: 8, up: "normal", down: "normal", assets: "尚無固定設備", reading: "最近巡檢正常", location: "中原－板新", history: [64, 63, 62, 60, 59, 58, 57] },
  { id: "Y14-Y15", from: 8, to: 9, up: "critical", down: "critical", assets: "MOK7–8 · LB7–8", reading: "LB7 6 L · MOK8 15 L", location: "板新－板橋雙向", history: [53, 47, 42, 34, 27, 18, 6] },
  { id: "Y15-Y16", from: 9, to: 10, up: "normal", down: "warning", assets: "MOK9–10 · LB9–10", reading: "下行設備需複查", location: "新埔民生往板橋方向", history: [61, 59, 55, 52, 45, 38, 29] },
  { id: "Y16-Y17", from: 10, to: 11, up: "unknown", down: "unknown", assets: "尚無設備資料", reading: "待建立監測點", location: "新埔民生－頭前庄", history: [0, 0, 0, 0, 0, 0, 0] },
  { id: "Y17-Y18", from: 11, to: 12, up: "normal", down: "normal", assets: "尚無固定設備", reading: "最近巡檢正常", location: "頭前庄－幸福", history: [67, 65, 64, 63, 60, 58, 56] },
  { id: "Y18-Y19", from: 12, to: 13, up: "unknown", down: "unknown", assets: "尚無設備資料", reading: "待建立監測點", location: "幸福－新北產業園區", history: [0, 0, 0, 0, 0, 0, 0] },
];

const alerts = [
  { asset: "LB-07", value: "6 L", area: "Y14 板新－Y15 板橋", change: "-5 L", level: "critical" },
  { asset: "MOK-08", value: "15 L", area: "Y14 板新－Y15 板橋", change: "-6 L", level: "critical" },
  { asset: "MOK-05", value: "17 L", area: "Y10 景安－Y11 中和", change: "無變動", level: "critical" },
  { asset: "MOK-01", value: "19 L", area: "Y7 十四張－Y8 秀朗橋", change: "-2 L", level: "warning" },
];

const statusText: Record<RailStatus, string> = {
  normal: "正常",
  warning: "注意",
  critical: "需處理",
  unknown: "尚無資料",
};

function segmentStatus(segment: Segment): RailStatus {
  if (segment.up === "critical" || segment.down === "critical") return "critical";
  if (segment.up === "warning" || segment.down === "warning") return "warning";
  if (segment.up === "unknown" && segment.down === "unknown") return "unknown";
  return "normal";
}

function HistoryChart({ segment }: { segment: Segment }) {
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
        animationDuration: 500,
        grid: { left: 34, right: 12, top: 24, bottom: 28 },
        tooltip: { trigger: "axis", valueFormatter: (value: unknown) => `${value} L` },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: ["7/18", "7/19", "7/20", "7/21", "7/22", "7/23", "7/24"],
          axisLine: { lineStyle: { color: styles.getPropertyValue("--line").trim() } },
          axisLabel: { color: styles.getPropertyValue("--muted").trim() },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          min: 0,
          max: 80,
          splitNumber: 4,
          axisLabel: { color: styles.getPropertyValue("--muted").trim(), formatter: "{value} L" },
          splitLine: { lineStyle: { color: styles.getPropertyValue("--line").trim() } },
        },
        series: [{
          name: "油量",
          type: "line",
          smooth: 0.35,
          symbolSize: 7,
          data: segment.history,
          lineStyle: { width: 3, color: colorMap[segmentStatus(segment)] },
          itemStyle: { color: colorMap[segmentStatus(segment)] },
          areaStyle: { color: colorMap[segmentStatus(segment)], opacity: 0.12 },
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
  }, [segment]);

  return <div className="history-chart" ref={chartRoot} role="img" aria-label={`${segment.id} 最近七次油量歷史折線圖`} />;
}

export default function Home() {
  const [selectedId, setSelectedId] = useState("Y10-Y11");
  const selected = useMemo(
    () => segments.find((segment) => segment.id === selectedId) ?? segments[4],
    [selectedId],
  );
  const selectedState = segmentStatus(selected);

  const selectStation = (stationIndex: number) => {
    const segmentIndex = Math.min(stationIndex, segments.length - 1);
    setSelectedId(segments[segmentIndex].id);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span></span><span></span></div>
          <div>
            <p className="eyebrow">NEW TAIPEI METRO · O&M</p>
            <h1>環狀線鋼軌狀態監測中心</h1>
          </div>
        </div>
        <nav className="topnav" aria-label="主要功能">
          <button type="button" className="nav-item active">全線總覽</button>
          <button type="button" className="nav-item">潤滑設備</button>
          <button type="button" className="nav-item">磨耗紀錄</button>
        </nav>
        <div className="sync-state"><span className="pulse-dot"></span>模擬資料 · 已同步</div>
      </header>

      <section className="page-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow dark">LINE CONDITION OVERVIEW</p>
            <h2>一眼找到需要處理的軌道區間</h2>
            <p>點選站點或軌道，查看上下行狀態、關聯設備與最近七次量測趨勢。</p>
          </div>
          <div className="updated-at">資料時間 <strong>2026-07-24 16:30</strong></div>
        </div>

        <section className="summary-grid" aria-label="全線摘要">
          <article className="summary-card danger-card"><span>待處理區間</span><strong>2</strong><small>涉及 3 台設備</small></article>
          <article className="summary-card warning-card"><span>注意區間</span><strong>2</strong><small>需安排複查</small></article>
          <article className="summary-card"><span>固定潤滑設備</span><strong>20</strong><small>MOK 10 · LB 10</small></article>
          <article className="summary-card"><span>磨耗量測點</span><strong>31</strong><small>南機廠小半徑曲線</small></article>
        </section>

        <section className="workspace-grid">
          <article className="panel route-panel">
            <div className="panel-heading">
              <div><span className="panel-kicker">全線拓撲</span><h3>Y6 大坪林－Y19 新北產業園區</h3></div>
              <div className="legend" aria-label="軌道狀態圖例">
                <span><i className="legend-line normal"></i>正常</span>
                <span><i className="legend-line warning"></i>注意</span>
                <span><i className="legend-line critical"></i>需處理</span>
                <span><i className="legend-line unknown"></i>尚無資料</span>
              </div>
            </div>

            <div className="direction-label up-label">上行軌 ↑</div>
            <div className="route-scroll">
              <div className="route-flow">
                {stations.map((station, index) => (
                  <div className="route-piece" key={station.id}>
                    <button
                      type="button"
                      className="station-button"
                      onClick={() => selectStation(index)}
                      aria-label={`查看 ${station.id} ${station.name}站相鄰區間`}
                    >
                      <span className="station-node">{station.id.replace("Y", "")}</span>
                      <strong>{station.id}</strong>
                      <small>{station.name}</small>
                    </button>
                    {index < segments.length && (() => {
                      const segment = segments[index];
                      const active = selectedId === segment.id;
                      return (
                        <button
                          type="button"
                          className={`segment-button ${active ? "selected" : ""}`}
                          onClick={() => setSelectedId(segment.id)}
                          aria-pressed={active}
                          aria-label={`${station.name}到${stations[index + 1].name}，${statusText[segmentStatus(segment)]}`}
                        >
                          <span className={`track-line ${segment.up}`}></span>
                          <span className="asset-label">{segment.assets.includes("MOK") ? segment.assets : ""}</span>
                          <span className={`track-line ${segment.down}`}></span>
                        </button>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
            <div className="direction-label down-label">下行軌 ↓</div>

            <button type="button" className="depot-branch" onClick={() => setSelectedId("Y6-Y7")}>
              <span className="branch-line" aria-hidden="true"></span>
              <span className="depot-icon">南</span>
              <span><strong>南機廠 · 進／離廠線</strong><small>9 組小半徑曲線 · 31 個量測點</small></span>
              <span className="status-pill warning">磨耗監測中</span>
            </button>
          </article>

          <aside className="panel detail-panel">
            <div className="detail-title-row">
              <div><span className="panel-kicker">選取區間</span><h3>{stations[selected.from].id} {stations[selected.from].name}－{stations[selected.to].id} {stations[selected.to].name}</h3></div>
              <span className={`status-pill ${selectedState}`}>{statusText[selectedState]}</span>
            </div>
            <dl className="detail-list">
              <div><dt>上行軌</dt><dd><span className={`state-dot ${selected.up}`}></span>{statusText[selected.up]}</dd></div>
              <div><dt>下行軌</dt><dd><span className={`state-dot ${selected.down}`}></span>{statusText[selected.down]}</dd></div>
              <div><dt>關聯設備</dt><dd>{selected.assets}</dd></div>
              <div><dt>最新讀值</dt><dd>{selected.reading}</dd></div>
              <div><dt>維修定位</dt><dd>{selected.location}</dd></div>
            </dl>
            <div className="chart-heading"><strong>最近七次油量趨勢</strong><span>單位：L</span></div>
            <HistoryChart segment={selected} />
            <button type="button" className="primary-action">開啟完整設備紀錄</button>
          </aside>
        </section>

        <section className="panel alerts-panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">異常清單</span><h3>優先處理設備</h3></div>
            <span className="alerts-count">4 筆低油量警報</span>
          </div>
          <div className="alerts-table" role="table" aria-label="低油量設備清單">
            <div className="table-row table-head" role="row"><span>設備</span><span>目前油量</span><span>軌道位置</span><span>相比前次</span><span>操作</span></div>
            {alerts.map((alert) => (
              <div className="table-row" role="row" key={alert.asset}>
                <strong>{alert.asset}</strong>
                <span><b className={alert.level === "critical" ? "danger-text" : "warning-text"}>{alert.value}</b></span>
                <span>{alert.area}</span>
                <span>{alert.change}</span>
                <button type="button" className="table-action" onClick={() => {
                  const match = segments.find((segment) => alert.area.includes(stations[segment.from].id) && alert.area.includes(stations[segment.to].id));
                  if (match) setSelectedId(match.id);
                }}>在圖上定位</button>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
