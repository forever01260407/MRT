"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { LubricationRecord } from "../lib/lubricationExcel";
import type { MonitorPayload, MonitoredLubricationRecord } from "../lib/lubricationMonitor";

type CorrectionForm = {
  deviceId: string;
  measuredDate: string;
  oilLevel: string;
  inspector: string;
  recordType: LubricationRecord["recordType"];
  refillAmount: string;
  correctedBy: string;
  correctionReason: string;
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
  return value;
}

function recordSummary(record: LubricationRecord) {
  return `${record.deviceId}｜${formatDate(record.measuredAt)}｜${record.oilLevel} L｜${record.recordType}`;
}

export default function MonitorPage() {
  const [records, setRecords] = useState<MonitoredLubricationRecord[]>([]);
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
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/lubrication?view=monitor", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as MonitorPayload & { error?: string };
        if (!response.ok || !payload.records) throw new Error(payload.error ?? "無法讀取完整紀錄。");
        if (!cancelled) setRecords(payload.records);
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : "無法讀取完整紀錄。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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

  const correctedCount = records.filter((item) => item.revisions.length > 0).length;
  const revisionCount = records.reduce((sum, item) => sum + item.revisions.length, 0);
  const deviceCount = new Set(records.map((item) => item.current.deviceId)).size;

  const openCorrection = (item: MonitoredLubricationRecord) => {
    setEditing(item);
    setCorrection({
      deviceId: item.current.deviceId,
      measuredDate: item.current.measuredAt.slice(0, 10),
      oilLevel: String(item.current.oilLevel),
      inspector: item.current.inspector,
      recordType: item.current.recordType,
      refillAmount: item.current.refillAmount === null ? "" : String(item.current.refillAmount),
      correctedBy: "",
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
    if (!correction.correctedBy.trim() || !correction.correctionReason.trim()) {
      setFeedback("請填寫更正人姓名與更正原因。");
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
          correctedBy: correction.correctedBy.trim(),
          correctionReason: correction.correctionReason.trim(),
          record,
        }),
      });
      const payload = await response.json() as MonitorPayload & { error?: string; details?: string[] };
      if (!response.ok || !payload.records) {
        throw new Error(payload.details?.[0] ?? payload.error ?? "更正紀錄寫入失敗。");
      }
      setRecords(payload.records);
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
    setDeletePassword("");
    setDeleteError("");
    setFeedback("");
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeletingRecord(null);
    setDeletePassword("");
    setDeleteError("");
  };

  const submitDelete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deletingRecord) return;
    if (!deletePassword.trim()) {
      setDeleteError("請輸入刪除密碼。");
      return;
    }

    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch("/api/lubrication", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ measurementId: deletingRecord.id, password: deletePassword.trim() }),
      });
      const payload = await response.json() as MonitorPayload & { error?: string; details?: string[] };
      if (!response.ok || !payload.records) {
        throw new Error(payload.details?.[0] ?? payload.error ?? "紀錄刪除失敗。");
      }

      const deletedSummary = recordSummary(deletingRecord.current);
      setRecords(payload.records);
      setExpandedId((current) => current === deletingRecord.id ? null : current);
      setDeletingRecord(null);
      setDeletePassword("");
      setFeedback(`${deletedSummary} 已永久刪除。`);
    } catch (submitError) {
      setDeleteError(submitError instanceof Error ? submitError.message : "紀錄刪除失敗。");
    } finally {
      setDeleting(false);
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
          <a href="/" className="nav-item">潤滑設備總覽</a>
          <a href="/wear" className="nav-item">正面軌道總覽</a>
          <a href="/side-wear" className="nav-item">側面軌道總覽</a>
        </nav>
        <div className="sync-state"><span className="pulse-dot"></span>完整歷程已連線</div>
      </header>

      <section className="page-content monitor-content">
        <div className="page-heading monitor-heading">
          <div>
            <p className="eyebrow dark">RECORD MONITOR · APPEND-ONLY HISTORY</p>
            <h2>完整紀錄 Monitor</h2>
            <p>更正時保留原始值與所有版本；儀表板只採用每筆紀錄的最新有效值。</p>
          </div>
          <a className="monitor-back-link" href="/">← 回到潤滑設備總覽</a>
        </div>

        <section className="monitor-safety-note" aria-label="資料安全說明">
          <span aria-hidden="true">◎</span>
          <div><strong>更正會保留原始資料</strong><p>更正會新增版本，並記錄更正人、原因與時間；永久刪除則必須通過密碼確認。</p></div>
        </section>

        <section className="monitor-summary-grid" aria-label="紀錄摘要">
          <article><span>原始紀錄</span><strong>{loading ? "—" : records.length}</strong><small>D1 永久保留</small></article>
          <article><span>已更正紀錄</span><strong>{loading ? "—" : correctedCount}</strong><small>共 {revisionCount} 個更正版本</small></article>
          <article><span>涵蓋設備</span><strong>{loading ? "—" : deviceCount}</strong><small>MOK 與 LB 設備</small></article>
        </section>

        <section className="monitor-panel">
          <header className="monitor-panel-header">
            <div><span className="panel-kicker">ALL MEASUREMENT RECORDS</span><h3>全部量測與補油紀錄</h3></div>
            <strong>{visibleRecords.length} / {records.length} 筆</strong>
          </header>

          <div className="monitor-filters" role="search">
            <label className="monitor-search"><span>搜尋</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="設備、人員、原因或檔名" /></label>
            <label><span>設備</span><select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}><option value="">全部設備</option>{deviceOptions.map((device) => <option key={device} value={device}>{device}</option>)}</select></label>
            <label><span>類型</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">全部類型</option><option value="量測">量測</option><option value="補油">補油</option></select></label>
            <label><span>狀態</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部狀態</option><option value="有效">有效</option><option value="已更正">已更正</option></select></label>
            <label><span>來源</span><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">全部來源</option><option value="現場登記">現場登記</option><option value="Excel 匯入">Excel 匯入</option></select></label>
          </div>

          {feedback && !editing ? <div className="monitor-feedback" role="status">{feedback}</div> : null}
          {error ? <div className="monitor-error" role="alert">{error}</div> : null}

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
                      <td><div className="monitor-row-actions"><button type="button" onClick={() => setExpandedId(expanded ? null : item.id)} aria-expanded={expanded}>{expanded ? "收起" : "查看歷程"}</button><button type="button" className="correct" onClick={() => openCorrection(item)}>更正</button><button type="button" className="delete" onClick={() => openDelete(item)}>刪除</button></div></td>
                    </tr>,
                    expanded ? <tr className="monitor-history-row" key={`${item.id}:history`}><td colSpan={10}>
                      <div className="monitor-history-heading"><div><strong>{item.current.deviceId} 完整歷程</strong><span>原始紀錄 ID：{item.id}</span></div><button type="button" onClick={() => openCorrection(item)}>＋ 新增更正版本</button></div>
                      <div className="monitor-timeline">
                        <article className="original"><div><span>原始值</span><time>{formatDateTime(item.createdAt)}</time></div><strong>{recordSummary(item.original)}</strong><p>現場人員：{item.original.inspector}｜來源：{item.sourceName}｜寫入者：{displayActor(item.createdBy)}</p></article>
                        {item.revisions.map((revision, index) => <article key={revision.id} className={index === item.revisions.length - 1 ? "latest" : "revision"}><div><span>更正版本 {revision.revisionNo}{index === item.revisions.length - 1 ? " · 目前有效" : ""}</span><time>{formatDateTime(revision.createdAt)}</time></div><strong>{recordSummary(revision)}</strong><p>更正人：{revision.correctedBy}｜原因：{revision.correctionReason}</p></article>)}
                      </div>
                    </td></tr> : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
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
              <label className="manual-entry-field"><span>更正人姓名 <b>*</b></span><input value={correction.correctedBy} onChange={(event) => setCorrection({ ...correction, correctedBy: event.target.value })} disabled={saving} placeholder="例如：王小明" required /></label>
              <label className="manual-entry-field"><span>更正原因 <b>*</b></span><input value={correction.correctionReason} onChange={(event) => setCorrection({ ...correction, correctionReason: event.target.value })} disabled={saving} placeholder="例如：現場數字誤植" required /></label>
            </div>
            {feedback ? <div className="manual-entry-error" role="alert">{feedback}</div> : null}
            <footer className="manual-entry-form-actions"><button type="button" className="manual-entry-cancel" onClick={() => { setEditing(null); setCorrection(null); setFeedback(""); }} disabled={saving}>取消</button><button type="submit" className="manual-entry-submit" disabled={saving}>{saving ? "正在保留新版本…" : "確認更正並保留原始值"}</button></footer>
          </form>
        </section>
      </div> : null}

      {deletingRecord ? <div className="manual-entry-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDelete(); }}>
        <section className="manual-entry-modal monitor-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
          <header className="manual-entry-modal-header"><div><span className="panel-kicker">PERMANENT DELETE</span><h3 id="delete-title" className="monitor-delete-title"><span aria-hidden="true">×</span>刪除紀錄</h3><p id="delete-description">刪除後會立即從 D1 移除，無法復原。</p></div><button type="button" className="manual-entry-close" onClick={closeDelete} disabled={deleting} aria-label="關閉刪除視窗">×</button></header>
          <form className="manual-entry-form" onSubmit={submitDelete}>
            <div className="monitor-delete-warning"><span>即將刪除</span><strong>{recordSummary(deletingRecord.current)}</strong><p>現場人員：{deletingRecord.current.inspector}｜來源：{deletingRecord.sourceType}</p></div>
            <label className="manual-entry-field"><span>刪除密碼 <b>*</b></span><input type="password" inputMode="numeric" autoComplete="off" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} disabled={deleting} placeholder="請輸入刪除密碼" autoFocus required /></label>
            {deleteError ? <div className="manual-entry-error" role="alert">{deleteError}</div> : null}
            <footer className="manual-entry-form-actions"><button type="button" className="manual-entry-cancel" onClick={closeDelete} disabled={deleting}>取消</button><button type="submit" className="monitor-delete-confirm" disabled={deleting}>{deleting ? "正在刪除…" : "確認永久刪除"}</button></footer>
          </form>
        </section>
      </div> : null}
    </main>
  );
}
