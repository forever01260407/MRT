"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { AdminNavItem, SessionMenu, useAuthSession } from "../components/AuthSessionProvider";
import type { LubricationRecord } from "../lib/lubricationExcel";
import type { MonitorPayload, MonitoredLubricationRecord } from "../lib/lubricationMonitor";

type CorrectionForm = {
  deviceId: string;
  measuredDate: string;
  oilLevel: string;
  inspector: string;
  recordType: LubricationRecord["recordType"];
  refillAmount: string;
  correctionReason: string;
};

type RecordView = "measurements" | "device-settings" | "deleted";

type DeviceAxleProfileEvent = {
  id: string;
  deviceId: string;
  previousStageCount: number | null;
  stageCount: number;
  previousAxleCount: number | null;
  axleCount: number;
  previousEffectiveDate: string | null;
  effectiveDate: string;
  changedBy: string;
  sourceIp: string;
  createdAt: string;
};

const deviceOptions = [
  ...Array.from({ length: 10 }, (_, index) => `MOK${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `LB${index + 1}`),
];

const deviceCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function formatDate(value: string) {
  return value.slice(0, 10).replaceAll("-", "/");
}

function formatDateTime(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function displayActor(value: string) {
  if (value === "initial-excel") return "初始 Excel";
  if (value === "local-development") return "本機登記";
  if (value === "website-admin") return "網站管理員";
  return value;
}

function recordSummary(record: LubricationRecord) {
  return `${record.deviceId}｜${formatDate(record.measuredAt)}｜${record.oilLevel} L｜${record.recordType}`;
}

function axleChangeType(event: DeviceAxleProfileEvent) {
  if (event.previousStageCount === null || event.previousAxleCount === null) return "建立階軸設定";
  const stageChanged = event.previousStageCount !== event.stageCount;
  const axleChanged = event.previousAxleCount !== event.axleCount;
  if (stageChanged && axleChanged) return "更動階軸";
  if (stageChanged) return "更動階數";
  if (axleChanged) return "更動軸數";
  if (event.previousEffectiveDate !== event.effectiveDate) return "更新生效日";
  return "重新確認設定";
}

function axleChangeSummary(event: DeviceAxleProfileEvent) {
  if (event.previousStageCount === null || event.previousAxleCount === null) {
    return `建立為 ${event.stageCount} 階 · ${event.axleCount} 軸`;
  }
  const changes = [
    event.previousStageCount !== event.stageCount ? `${event.previousStageCount} 階 → ${event.stageCount} 階` : "",
    event.previousAxleCount !== event.axleCount ? `${event.previousAxleCount} 軸 → ${event.axleCount} 軸` : "",
    event.previousEffectiveDate !== event.effectiveDate
      ? `生效日 ${event.previousEffectiveDate ? formatDate(event.previousEffectiveDate) : "未設定"} → ${formatDate(event.effectiveDate)}`
      : "",
  ].filter(Boolean);
  return changes.join(" · ") || `${event.stageCount} 階 · ${event.axleCount} 軸（設定未變）`;
}

function RecordTimeline({ item }: { item: MonitoredLubricationRecord }) {
  return <div className="monitor-timeline">
    <article className="original"><div><span>原始值</span><time>{formatDateTime(item.createdAt)}</time></div><strong>{recordSummary(item.original)}</strong><p>現場人員：{item.original.inspector}｜來源：{item.sourceName}｜寫入者：{displayActor(item.createdBy)}｜IP：{item.createdIp}</p></article>
    {item.revisions.map((revision, index) => <article key={revision.id} className={index === item.revisions.length - 1 && !item.deletion ? "latest" : "revision"}><div><span>更正版本 {revision.revisionNo}{index === item.revisions.length - 1 ? item.deletion ? " · 刪除前有效" : " · 目前有效" : ""}</span><time>{formatDateTime(revision.createdAt)}</time></div><strong>{recordSummary(revision)}</strong><p>更正人：{revision.correctedBy}｜原因：{revision.correctionReason}｜IP：{revision.sourceIp}</p></article>)}
    {item.lifecycleEvents.map((lifecycle) => <article key={lifecycle.id} className={`lifecycle ${lifecycle.action}`}><div><span>{lifecycle.action === "deleted" ? "刪除紀錄" : "還原紀錄"}</span><time>{formatDateTime(lifecycle.createdAt)}</time></div><strong>{lifecycle.action === "deleted" ? "已從總覽、圖表與統計中隱藏" : "已恢復為有效紀錄"}</strong><p>操作者：@{displayActor(lifecycle.actor)}｜原因：{lifecycle.reason}｜IP：{lifecycle.sourceIp}</p></article>)}
  </div>;
}

export default function MonitorPage() {
  const { user: signedInUser } = useAuthSession();
  const [records, setRecords] = useState<MonitoredLubricationRecord[]>([]);
  const [deletedRecords, setDeletedRecords] = useState<MonitoredLubricationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sortByDevice, setSortByDevice] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MonitoredLubricationRecord | null>(null);
  const [correction, setCorrection] = useState<CorrectionForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingRecord, setDeletingRecord] = useState<MonitoredLubricationRecord | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [awaitingFinalDeleteConfirmation, setAwaitingFinalDeleteConfirmation] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [restoringRecord, setRestoringRecord] = useState<MonitoredLubricationRecord | null>(null);
  const [restoreReason, setRestoreReason] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [recordView, setRecordView] = useState<RecordView>("measurements");
  const [axleChangeLogs, setAxleChangeLogs] = useState<DeviceAxleProfileEvent[]>([]);
  const [axleLogsLoading, setAxleLogsLoading] = useState(true);
  const [axleLogsError, setAxleLogsError] = useState("");
  const [axleSearch, setAxleSearch] = useState("");
  const [axleDeviceFilter, setAxleDeviceFilter] = useState("");
  const [deletedSearch, setDeletedSearch] = useState("");
  const [deletedDeviceFilter, setDeletedDeviceFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/lubrication?view=monitor", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as MonitorPayload & { error?: string };
        if (!response.ok || !payload.records) throw new Error(payload.error ?? "無法讀取完整紀錄。");
        if (!cancelled) {
          setRecords(payload.records);
          setDeletedRecords(payload.deletedRecords ?? []);
        }
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : "無法讀取完整紀錄。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/device-axle-profiles", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { changeLogs?: DeviceAxleProfileEvent[]; error?: string };
        if (!response.ok || !payload.changeLogs) throw new Error(payload.error ?? "無法讀取設備設定紀錄。");
        if (!cancelled) setAxleChangeLogs(payload.changeLogs);
      })
      .catch((fetchError) => {
        if (!cancelled) setAxleLogsError(fetchError instanceof Error ? fetchError.message : "無法讀取設備設定紀錄。");
      })
      .finally(() => {
        if (!cancelled) setAxleLogsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const visibleRecords = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-TW");
    return records
      .filter((item) => !deviceFilter || item.current.deviceId === deviceFilter)
      .filter((item) => !typeFilter || item.current.recordType === typeFilter)
      .filter((item) => !statusFilter || item.status === statusFilter)
      .filter((item) => !sourceFilter || item.sourceType === sourceFilter)
      .filter((item) => {
        if (!keyword) return true;
        const searchable = [
          item.current.deviceId,
          item.current.inspector,
          item.sourceName,
          item.createdBy,
          ...item.revisions.flatMap((revision) => [revision.correctedBy, revision.correctionReason]),
        ].join(" ").toLocaleLowerCase("zh-TW");
        return searchable.includes(keyword);
      })
      .sort((left, right) => {
        if (sortByDevice) {
          const deviceOrder = deviceCollator.compare(left.current.deviceId, right.current.deviceId);
          if (deviceOrder !== 0) return deviceOrder;
        }
        return right.current.measuredAt.localeCompare(left.current.measuredAt)
          || right.createdAt.localeCompare(left.createdAt);
      });
  }, [deviceFilter, records, search, sortByDevice, sourceFilter, statusFilter, typeFilter]);

  const visibleAxleChangeLogs = useMemo(() => {
    const keyword = axleSearch.trim().toLocaleLowerCase("zh-TW");
    return axleChangeLogs.filter((event) => {
      if (axleDeviceFilter && event.deviceId !== axleDeviceFilter) return false;
      if (!keyword) return true;
      return [event.deviceId, event.changedBy, axleChangeType(event), axleChangeSummary(event)]
        .join(" ")
        .toLocaleLowerCase("zh-TW")
        .includes(keyword);
    });
  }, [axleChangeLogs, axleDeviceFilter, axleSearch]);

  const visibleDeletedRecords = useMemo(() => {
    const keyword = deletedSearch.trim().toLocaleLowerCase("zh-TW");
    return deletedRecords.filter((item) => {
      if (deletedDeviceFilter && item.current.deviceId !== deletedDeviceFilter) return false;
      if (!keyword) return true;
      return [
        item.current.deviceId,
        item.current.inspector,
        item.sourceName,
        item.deletion?.deletedBy,
        item.deletion?.deleteReason,
        item.deletion?.deletedIp,
      ].join(" ").toLocaleLowerCase("zh-TW").includes(keyword);
    });
  }, [deletedDeviceFilter, deletedRecords, deletedSearch]);

  const correctedCount = records.filter((item) => item.revisions.length > 0).length;
  const revisionCount = records.reduce((sum, item) => sum + item.revisions.length, 0);
  const canManageDeleted = signedInUser?.role === "supervisor" || signedInUser?.role === "admin";

  const openCorrection = (item: MonitoredLubricationRecord) => {
    setEditing(item);
    setCorrection({
      deviceId: item.current.deviceId,
      measuredDate: item.current.measuredAt.slice(0, 10),
      oilLevel: String(item.current.oilLevel),
      inspector: item.current.inspector,
      recordType: item.current.recordType,
      refillAmount: item.current.refillAmount === null ? "" : String(item.current.refillAmount),
      correctionReason: "",
    });
    setFeedback("");
  };

  const submitCorrection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || !correction) return;
    const oilLevel = Number(correction.oilLevel);
    const refillAmount = correction.recordType === "補油" ? Number(correction.refillAmount) : null;
    if (!correction.deviceId || !correction.measuredDate || !Number.isFinite(oilLevel) || oilLevel < 0) {
      setFeedback("請確認設備、量測日期與油量。");
      return;
    }
    if (!correction.correctionReason.trim()) {
      setFeedback("請填寫更正原因。");
      return;
    }
    if (correction.recordType === "補油" && (!Number.isFinite(refillAmount) || refillAmount === null || refillAmount <= 0)) {
      setFeedback("補油紀錄必須填寫大於 0 的補油量。");
      return;
    }

    const record: LubricationRecord = {
      deviceId: correction.deviceId,
      measuredAt: `${correction.measuredDate}T00:00:00`,
      oilLevel: Number(oilLevel.toFixed(2)),
      inspector: correction.inspector.trim() || "未指定",
      recordType: correction.recordType,
      refillAmount: correction.recordType === "補油" ? Number(refillAmount!.toFixed(2)) : null,
    };

    setSaving(true);
    setFeedback("");
    try {
      const response = await fetch("/api/lubrication", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          measurementId: editing.id,
          correctionReason: correction.correctionReason.trim(),
          record,
        }),
      });
      const payload = await response.json() as MonitorPayload & { error?: string; details?: string[] };
      if (!response.ok || !payload.records) {
        throw new Error(payload.details?.[0] ?? payload.error ?? "更正紀錄寫入失敗。");
      }
      setRecords(payload.records);
      setDeletedRecords(payload.deletedRecords ?? []);
      setExpandedId(editing.id);
      setEditing(null);
      setCorrection(null);
      setFeedback(`${recordSummary(record)} 已新增更正版本，原始值仍然保留。`);
    } catch (submitError) {
      setFeedback(submitError instanceof Error ? submitError.message : "更正紀錄寫入失敗。");
    } finally {
      setSaving(false);
    }
  };

  const openDelete = (item: MonitoredLubricationRecord) => {
    setDeletingRecord(item);
    setDeleteReason("");
    setDeleteError("");
    setAwaitingFinalDeleteConfirmation(false);
    setFeedback("");
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeletingRecord(null);
    setDeleteReason("");
    setDeleteError("");
    setAwaitingFinalDeleteConfirmation(false);
  };

  const requestFinalDeleteConfirmation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deletingRecord) return;
    if (!deleteReason.trim()) {
      setDeleteError("請填寫刪除原因。");
      return;
    }
    setDeleteError("");
    setAwaitingFinalDeleteConfirmation(true);
  };

  const submitDelete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deletingRecord || !awaitingFinalDeleteConfirmation) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch("/api/lubrication", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ measurementId: deletingRecord.id, deleteReason: deleteReason.trim() }),
      });
      const payload = await response.json() as MonitorPayload & { error?: string; details?: string[] };
      if (!response.ok || !payload.records) {
        throw new Error(payload.details?.[0] ?? payload.error ?? "紀錄刪除失敗。");
      }

      const deletedSummary = recordSummary(deletingRecord.current);
      setRecords(payload.records);
      setDeletedRecords(payload.deletedRecords ?? []);
      setExpandedId((current) => current === deletingRecord.id ? null : current);
      setDeletingRecord(null);
      setDeleteReason("");
      setAwaitingFinalDeleteConfirmation(false);
      setFeedback(`${deletedSummary} 已移至「已刪除紀錄」，資料與歷程仍完整保留。`);
    } catch (submitError) {
      setDeleteError(submitError instanceof Error ? submitError.message : "紀錄刪除失敗。");
    } finally {
      setDeleting(false);
    }
  };

  const openRestore = (item: MonitoredLubricationRecord) => {
    setRestoringRecord(item);
    setRestoreReason("");
    setRestoreError("");
    setFeedback("");
  };

  const closeRestore = () => {
    if (restoring) return;
    setRestoringRecord(null);
    setRestoreReason("");
    setRestoreError("");
  };

  const submitRestore = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!restoringRecord) return;
    if (!restoreReason.trim()) {
      setRestoreError("請填寫還原原因。");
      return;
    }
    setRestoring(true);
    setRestoreError("");
    try {
      const response = await fetch("/api/lubrication", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ measurementId: restoringRecord.id, restoreReason: restoreReason.trim() }),
      });
      const payload = await response.json() as MonitorPayload & { error?: string; details?: string[] };
      if (!response.ok || !payload.records) {
        throw new Error(payload.details?.[0] ?? payload.error ?? "紀錄還原失敗。");
      }
      const restoredSummary = recordSummary(restoringRecord.current);
      setRecords(payload.records);
      setDeletedRecords(payload.deletedRecords ?? []);
      setExpandedId((current) => current === restoringRecord.id ? null : current);
      setRestoringRecord(null);
      setRestoreReason("");
      setFeedback(`${restoredSummary} 已還原，並重新納入總覽、圖表與統計。`);
    } catch (submitError) {
      setRestoreError(submitError instanceof Error ? submitError.message : "紀錄還原失敗。");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <main className="app-shell monitor-page">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span></span><span></span></div>
          <div>
            <p className="eyebrow">NEW TAIPEI METRO · O&amp;M</p>
            <h1>環狀線鋼軌狀態監測中心</h1>
          </div>
        </div>
        <nav className="topnav" aria-label="主要功能">
          <Link href="/" className="nav-item">潤滑設備總覽</Link>
          <a href="/wear" className="nav-item">正面軌道總覽</a>
          <a href="/side-wear" className="nav-item">側面軌道總覽</a>
          <AdminNavItem />
        </nav>
        <div className="topbar-status-group">
          <div className="sync-state"><span className="pulse-dot"></span>完整歷程已連線</div>
          <SessionMenu />
        </div>
      </header>

      <section className="page-content monitor-content">
        <div className="page-heading monitor-heading">
          <div>
            <p className="eyebrow dark">RECORD MONITOR · APPEND-ONLY HISTORY</p>
            <h2>完整紀錄 Monitor</h2>
            <p>集中查看量測版本、設備設定與已刪除紀錄；所有變更都會保留操作者、時間與 IP。</p>
          </div>
          <Link className="monitor-back-link" href="/">← 回到潤滑設備總覽</Link>
        </div>

        <section className="monitor-safety-note" aria-label="資料安全說明">
          <span aria-hidden="true">◎</span>
          <div><strong>異動會保留原始資料</strong><p>更正會新增版本；刪除只會從總覽與計算中隱藏，仍可由 supervisor 或 admin 查看與還原。</p></div>
        </section>

        <section className="monitor-summary-grid" aria-label="紀錄摘要">
          <article><span>有效紀錄</span><strong>{loading ? "—" : records.length}</strong><small>總覽與計算中使用</small></article>
          <article><span>已更正紀錄</span><strong>{loading ? "—" : correctedCount}</strong><small>共 {revisionCount} 個更正版本</small></article>
          <article><span>已刪除紀錄</span><strong>{loading ? "—" : deletedRecords.length}</strong><small>保留於 D1，可隨時還原</small></article>
          <article><span>設備設定異動</span><strong>{axleLogsLoading ? "—" : axleChangeLogs.length}</strong><small>階數、軸數與生效日</small></article>
        </section>

        <section className="monitor-panel">
          <header className="monitor-panel-header">
            <div><span className="panel-kicker">{recordView === "measurements" ? "ALL MEASUREMENT RECORDS" : recordView === "device-settings" ? "DEVICE CONFIGURATION LOG" : "DELETED RECORDS"}</span><h3>{recordView === "measurements" ? "全部量測與補油紀錄" : recordView === "device-settings" ? "設備設定紀錄" : "已刪除紀錄"}</h3></div>
            <strong>{recordView === "measurements" ? `${visibleRecords.length} / ${records.length}` : recordView === "device-settings" ? `${visibleAxleChangeLogs.length} / ${axleChangeLogs.length}` : `${visibleDeletedRecords.length} / ${deletedRecords.length}`} 筆</strong>
          </header>

          <div className="monitor-view-tabs" role="tablist" aria-label="紀錄類型">
            <button type="button" role="tab" aria-selected={recordView === "measurements"} className={recordView === "measurements" ? "active" : ""} onClick={() => setRecordView("measurements")}>量測與補油</button>
            <button type="button" role="tab" aria-selected={recordView === "device-settings"} className={recordView === "device-settings" ? "active" : ""} onClick={() => setRecordView("device-settings")}>設備設定紀錄 <span>{axleChangeLogs.length}</span></button>
            <button type="button" role="tab" aria-selected={recordView === "deleted"} className={`deleted-tab ${recordView === "deleted" ? "active" : ""}`} onClick={() => setRecordView("deleted")}>已刪除紀錄 <span>{deletedRecords.length}</span></button>
          </div>

          {feedback && !editing ? <div className="monitor-feedback" role="status">{feedback}</div> : null}
          {error ? <div className="monitor-error" role="alert">{error}</div> : null}

          {recordView === "measurements" ? <>
          <div className="monitor-filters" role="search">
            <label className="monitor-search"><span>搜尋</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="設備、人員、原因或檔名" /></label>
            <label><span>設備</span><select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}><option value="">全部設備</option>{deviceOptions.map((device) => <option key={device} value={device}>{device}</option>)}</select></label>
            <label><span>類型</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">全部類型</option><option value="量測">量測</option><option value="補油">補油</option></select></label>
            <label><span>狀態</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部狀態</option><option value="有效">有效</option><option value="已更正">已更正</option></select></label>
            <label><span>來源</span><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">全部來源</option><option value="現場登記">現場登記</option><option value="Excel 匯入">Excel 匯入</option></select></label>
          </div>

          <div className="monitor-table-shell">
            <table className="monitor-table">
              <thead><tr><th>狀態</th><th aria-sort={sortByDevice ? "ascending" : "none"}><button type="button" className={`monitor-sort-button ${sortByDevice ? "active" : ""}`} onClick={() => setSortByDevice((current) => !current)} aria-label={sortByDevice ? "取消設備排序，回到量測日期順序" : "切換為 LB1 到 MOK10 的設備順序"}>設備 <span>{sortByDevice ? "LB → MOK" : "↕"}</span></button></th><th>量測日期</th><th>油量</th><th>類型</th><th>補油量</th><th>現場人員</th><th>來源</th><th>登記時間</th><th>紀錄操作</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={10} className="monitor-empty">正在從 D1 讀取完整紀錄…</td></tr> : null}
                {!loading && !visibleRecords.length ? <tr><td colSpan={10} className="monitor-empty">找不到符合篩選條件的紀錄。</td></tr> : null}
                {visibleRecords.map((item) => {
                  const expanded = expandedId === item.id;
                  return [
                    <tr key={item.id} className={item.status === "已更正" ? "corrected" : undefined}>
                      <td><span className={`monitor-status ${item.status === "已更正" ? "corrected" : "active"}`}>{item.status}</span></td>
                      <td><strong>{item.current.deviceId}</strong></td>
                      <td>{formatDate(item.current.measuredAt)}</td>
                      <td><strong>{item.current.oilLevel} L</strong></td>
                      <td>{item.current.recordType}</td>
                      <td>{item.current.refillAmount === null ? "—" : `${item.current.refillAmount} L`}</td>
                      <td>{item.current.inspector}</td>
                      <td><span className="monitor-source">{item.sourceType}</span></td>
                      <td>{formatDateTime(item.createdAt)}</td>
                      <td><div className="monitor-row-actions"><button type="button" onClick={() => setExpandedId(expanded ? null : item.id)} aria-expanded={expanded}>{expanded ? "收起" : "查看歷程"}</button><button type="button" className="correct" onClick={() => openCorrection(item)}>更正</button>{canManageDeleted ? <button type="button" className="delete" onClick={() => openDelete(item)}>刪除</button> : null}</div></td>
                    </tr>,
                    expanded ? <tr className="monitor-history-row" key={`${item.id}:history`}><td colSpan={10}>
                      <div className="monitor-history-heading"><div><strong>{item.current.deviceId} 完整歷程</strong><span>原始紀錄 ID：{item.id}</span></div><button type="button" onClick={() => openCorrection(item)}>＋ 新增更正版本</button></div>
                      <RecordTimeline item={item} />
                    </td></tr> : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
          </> : recordView === "device-settings" ? <>
            <div className="monitor-filters monitor-axle-log-filters" role="search">
              <label className="monitor-search"><span>搜尋設定紀錄</span><input value={axleSearch} onChange={(event) => setAxleSearch(event.target.value)} placeholder="設備、操作者或異動內容" /></label>
              <label><span>設備</span><select value={axleDeviceFilter} onChange={(event) => setAxleDeviceFilter(event.target.value)}><option value="">全部設備</option>{deviceOptions.map((device) => <option key={device} value={device}>{device}</option>)}</select></label>
            </div>
            {axleLogsError ? <div className="monitor-error" role="alert">{axleLogsError}</div> : null}
            <div className="monitor-table-shell">
              <table className="monitor-table monitor-axle-log-table">
                <thead><tr><th>狀態</th><th>設備</th><th>生效日期</th><th>類型</th><th>異動內容</th><th>操作者</th><th>IP</th><th>登記時間</th></tr></thead>
                <tbody>
                  {axleLogsLoading ? <tr><td colSpan={8} className="monitor-empty">正在從 D1 讀取設備設定紀錄…</td></tr> : null}
                  {!axleLogsLoading && !visibleAxleChangeLogs.length ? <tr><td colSpan={8} className="monitor-empty">目前沒有符合條件的設備設定紀錄。</td></tr> : null}
                  {visibleAxleChangeLogs.map((event) => <tr key={event.id}>
                    <td><span className="monitor-status logged">已記錄</span></td>
                    <td><strong>{event.deviceId}</strong></td>
                    <td>{formatDate(event.effectiveDate)}</td>
                    <td><span className="monitor-change-type">{axleChangeType(event)}</span></td>
                    <td><strong>{axleChangeSummary(event)}</strong></td>
                    <td>@{displayActor(event.changedBy)}</td>
                    <td>{event.sourceIp}</td>
                    <td>{formatDateTime(event.createdAt)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </> : <>
            <div className="monitor-filters monitor-deleted-filters" role="search">
              <label className="monitor-search"><span>搜尋已刪除紀錄</span><input value={deletedSearch} onChange={(event) => setDeletedSearch(event.target.value)} placeholder="設備、人員、刪除者、原因或 IP" /></label>
              <label><span>設備</span><select value={deletedDeviceFilter} onChange={(event) => setDeletedDeviceFilter(event.target.value)}><option value="">全部設備</option>{deviceOptions.map((device) => <option key={device} value={device}>{device}</option>)}</select></label>
            </div>
            <div className="monitor-table-shell">
              <table className="monitor-table monitor-deleted-table">
                <thead><tr><th>狀態</th><th>設備</th><th>量測日期</th><th>刪除前內容</th><th>來源</th><th>刪除原因</th><th>刪除者</th><th>刪除時間</th><th>IP</th><th>紀錄操作</th></tr></thead>
                <tbody>
                  {loading ? <tr><td colSpan={10} className="monitor-empty">正在讀取已刪除紀錄…</td></tr> : null}
                  {!loading && !visibleDeletedRecords.length ? <tr><td colSpan={10} className="monitor-empty">目前沒有已刪除紀錄。</td></tr> : null}
                  {visibleDeletedRecords.map((item) => {
                    const expanded = expandedId === item.id;
                    return [
                      <tr key={item.id} className="deleted-record">
                        <td><span className="monitor-status deleted">已刪除</span></td>
                        <td><strong>{item.current.deviceId}</strong></td>
                        <td>{formatDate(item.current.measuredAt)}</td>
                        <td><strong>{item.current.oilLevel} L</strong> · {item.current.recordType}</td>
                        <td><span className="monitor-source">{item.sourceType}</span></td>
                        <td className="monitor-reason-cell">{item.deletion?.deleteReason}</td>
                        <td>@{displayActor(item.deletion?.deletedBy ?? "未知")}</td>
                        <td>{item.deletion ? formatDateTime(item.deletion.deletedAt) : "—"}</td>
                        <td>{item.deletion?.deletedIp ?? "—"}</td>
                        <td><div className="monitor-row-actions"><button type="button" onClick={() => setExpandedId(expanded ? null : item.id)} aria-expanded={expanded}>{expanded ? "收起" : "查看歷程"}</button>{canManageDeleted ? <button type="button" className="restore" onClick={() => openRestore(item)}>還原</button> : null}</div></td>
                      </tr>,
                      expanded ? <tr className="monitor-history-row" key={`${item.id}:deleted-history`}><td colSpan={10}>
                        <div className="monitor-history-heading"><div><strong>{item.current.deviceId} 完整歷程</strong><span>原始紀錄 ID：{item.id}</span></div>{canManageDeleted ? <button type="button" onClick={() => openRestore(item)}>↺ 還原這筆紀錄</button> : null}</div>
                        <RecordTimeline item={item} />
                      </td></tr> : null,
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </>}
        </section>
      </section>

      {editing && correction ? <div className="manual-entry-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) { setEditing(null); setCorrection(null); setFeedback(""); } }}>
        <section className="manual-entry-modal monitor-correction-modal" role="dialog" aria-modal="true" aria-labelledby="correction-title">
          <header className="manual-entry-modal-header"><div><span className="panel-kicker">APPEND CORRECTION VERSION</span><h3 id="correction-title"><span aria-hidden="true">↺</span>更正紀錄</h3><p>系統會保留原始值，並將這次內容新增為下一個版本。</p></div><button type="button" className="manual-entry-close" onClick={() => { setEditing(null); setCorrection(null); setFeedback(""); }} disabled={saving} aria-label="關閉更正視窗">×</button></header>
          <form className="manual-entry-form" onSubmit={submitCorrection}>
            <div className="monitor-original-summary"><span>目前有效值</span><strong>{recordSummary(editing.current)}</strong></div>
            <div className="manual-entry-field-row">
              <label className="manual-entry-field"><span>設備名稱 <b>*</b></span><select value={correction.deviceId} onChange={(event) => setCorrection({ ...correction, deviceId: event.target.value })} disabled={saving}>{deviceOptions.map((device) => <option key={device} value={device}>{device}</option>)}</select></label>
              <label className="manual-entry-field"><span>量測日期 <b>*</b></span><input type="date" value={correction.measuredDate} onChange={(event) => setCorrection({ ...correction, measuredDate: event.target.value })} disabled={saving} required /></label>
            </div>
            <div className="manual-entry-field-row">
              <label className="manual-entry-field"><span>現場油量 (L) <b>*</b></span><input type="number" min="0" step="0.01" value={correction.oilLevel} onChange={(event) => setCorrection({ ...correction, oilLevel: event.target.value })} disabled={saving} required /></label>
              <label className="manual-entry-field"><span>紀錄類型 <b>*</b></span><select value={correction.recordType} onChange={(event) => setCorrection({ ...correction, recordType: event.target.value as LubricationRecord["recordType"], refillAmount: event.target.value === "補油" ? correction.refillAmount : "" })} disabled={saving}><option value="量測">量測</option><option value="補油">補油</option></select></label>
            </div>
            <div className="manual-entry-field-row">
              <label className="manual-entry-field"><span>現場人員</span><input value={correction.inspector} onChange={(event) => setCorrection({ ...correction, inspector: event.target.value })} disabled={saving} placeholder="留白時記錄為未指定" /></label>
              {correction.recordType === "補油" ? <label className="manual-entry-field"><span>本次補油量 (L) <b>*</b></span><input type="number" min="0.01" step="0.01" value={correction.refillAmount} onChange={(event) => setCorrection({ ...correction, refillAmount: event.target.value })} disabled={saving} required /></label> : <div className="manual-entry-type-note">量測紀錄不需要補油量。</div>}
            </div>
            <div className="manual-entry-field-row">
              <label className="manual-entry-field"><span>更正人（登入身分）</span><input value={signedInUser?.name || signedInUser?.username || ""} readOnly aria-readonly="true" /></label>
              <label className="manual-entry-field"><span>更正原因 <b>*</b></span><input value={correction.correctionReason} onChange={(event) => setCorrection({ ...correction, correctionReason: event.target.value })} disabled={saving} placeholder="例如：現場數字誤植" required /></label>
            </div>
            {feedback ? <div className="manual-entry-error" role="alert">{feedback}</div> : null}
            <footer className="manual-entry-form-actions"><button type="button" className="manual-entry-cancel" onClick={() => { setEditing(null); setCorrection(null); setFeedback(""); }} disabled={saving}>取消</button><button type="submit" className="manual-entry-submit" disabled={saving}>{saving ? "正在保留新版本…" : "確認更正並保留原始值"}</button></footer>
          </form>
        </section>
      </div> : null}

      {deletingRecord ? <div className="manual-entry-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDelete(); }}>
        <section className="manual-entry-modal monitor-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
          <header className="manual-entry-modal-header"><div><span className="panel-kicker">SOFT DELETE</span><h3 id="delete-title" className="monitor-delete-title"><span aria-hidden="true">×</span>{awaitingFinalDeleteConfirmation ? "確定移至已刪除紀錄？" : "刪除紀錄"}</h3><p id="delete-description">{awaitingFinalDeleteConfirmation ? "刪除後會從總覽、圖表與統計中隱藏，仍可由 supervisor 或 admin 還原。" : "資料不會從 D1 抹除，系統會保留完整內容與操作歷程。"}</p></div><button type="button" className="manual-entry-close" onClick={closeDelete} disabled={deleting} aria-label="關閉刪除視窗">×</button></header>
          <form className="manual-entry-form" onSubmit={awaitingFinalDeleteConfirmation ? submitDelete : requestFinalDeleteConfirmation}>
            <div className="monitor-delete-warning"><span>即將刪除</span><strong>{recordSummary(deletingRecord.current)}</strong><p>現場人員：{deletingRecord.current.inspector}｜來源：{deletingRecord.sourceType}</p></div>
            <label className="manual-entry-field"><span>刪除原因 <b>*</b></span><input value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} disabled={deleting || awaitingFinalDeleteConfirmation} placeholder="例如：量測值誤植或重複資料" maxLength={500} required /></label>
            {awaitingFinalDeleteConfirmation ? <div className="monitor-delete-final-note" role="alert"><strong>請再次確認上方資料。</strong><span>系統會記錄刪除者、伺服器時間、IP 與原因，並將資料放入「已刪除紀錄」。</span></div> : <div className="monitor-delete-final-note"><strong>將以 {signedInUser?.name || signedInUser?.username || "目前登入者"} 的身分執行。</strong><span>只有 supervisor 與 admin 可以刪除及還原紀錄。</span></div>}
            {deleteError ? <div className="manual-entry-error" role="alert">{deleteError}</div> : null}
            <footer className="manual-entry-form-actions"><button type="button" className="manual-entry-cancel" onClick={awaitingFinalDeleteConfirmation ? () => { setAwaitingFinalDeleteConfirmation(false); setDeleteError(""); } : closeDelete} disabled={deleting}>{awaitingFinalDeleteConfirmation ? "返回檢查" : "取消"}</button><button type="submit" className="monitor-delete-confirm" disabled={deleting}>{deleting ? "正在刪除…" : awaitingFinalDeleteConfirmation ? "確定移至已刪除紀錄" : "繼續刪除"}</button></footer>
          </form>
        </section>
      </div> : null}

      {restoringRecord ? <div className="manual-entry-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRestore(); }}>
        <section className="manual-entry-modal monitor-restore-modal" role="dialog" aria-modal="true" aria-labelledby="restore-title" aria-describedby="restore-description">
          <header className="manual-entry-modal-header"><div><span className="panel-kicker">RESTORE RECORD</span><h3 id="restore-title" className="monitor-restore-title"><span aria-hidden="true">↺</span>還原紀錄</h3><p id="restore-description">還原後會重新出現在量測紀錄、總覽、圖表與統計中，刪除歷程仍會保留。</p></div><button type="button" className="manual-entry-close" onClick={closeRestore} disabled={restoring} aria-label="關閉還原視窗">×</button></header>
          <form className="manual-entry-form" onSubmit={submitRestore}>
            <div className="monitor-restore-summary"><span>將還原</span><strong>{recordSummary(restoringRecord.current)}</strong><p>原刪除者：@{displayActor(restoringRecord.deletion?.deletedBy ?? "未知")}｜時間：{restoringRecord.deletion ? formatDateTime(restoringRecord.deletion.deletedAt) : "—"}</p></div>
            <label className="manual-entry-field"><span>還原原因 <b>*</b></span><input value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} disabled={restoring} placeholder="例如：確認原紀錄正確" maxLength={500} required /></label>
            <div className="monitor-restore-note"><strong>將以 {signedInUser?.name || signedInUser?.username || "目前登入者"} 的身分還原。</strong><span>系統會記錄還原者、伺服器時間、IP 與原因。</span></div>
            {restoreError ? <div className="manual-entry-error" role="alert">{restoreError}</div> : null}
            <footer className="manual-entry-form-actions"><button type="button" className="manual-entry-cancel" onClick={closeRestore} disabled={restoring}>取消</button><button type="submit" className="monitor-restore-confirm" disabled={restoring}>{restoring ? "正在還原…" : "確認還原紀錄"}</button></footer>
          </form>
        </section>
      </div> : null}
    </main>
  );
}
