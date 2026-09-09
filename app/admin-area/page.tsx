"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { AdminNavItem, SessionMenu, useAuthSession } from "../components/AuthSessionProvider";
import { getRoleDisplayLabel } from "../lib/rolePresentation";
import type { RoleCode } from "../lib/rolePresentation";

type AdminSection = "overview" | "users" | "roles" | "audit" | "security";
type UserRole = RoleCode;
type UserStatus = "active" | "pending" | "locked" | "disabled";

type ManagedUser = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  lastLogin: string;
  createdAt: string;
  createdAtRaw: string;
  createdBy: string;
  sessions: number;
};

type StoredApiUser = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type SignInOutcome = "success" | "invalid_credentials" | "account_not_found" | "account_disabled" | "account_locked" | "rate_limited";

type StoredSignInEvent = {
  id: string;
  username: string;
  success: boolean;
  outcome: SignInOutcome;
  source: string;
  createdAt: string;
};

type StoredAuditEvent = {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorUsername: string;
  actorRole: string;
  sourceIp: string;
  userAgent: string | null;
  requestId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceLabel: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  result: "success" | "failure";
  errorCode: string | null;
  metadata: unknown;
  originType: string | null;
  originId: string | null;
  historical: boolean;
};

const sectionItems: Array<{ id: AdminSection; marker: string; label: string; description: string }> = [
  { id: "overview", marker: "總", label: "總覽", description: "帳號與系統摘要" },
  { id: "users", marker: "人", label: "人員帳號", description: "新增、停用與重設" },
  { id: "roles", marker: "權", label: "角色與權限", description: "檢視功能授權" },
  { id: "audit", marker: "稽", label: "操作紀錄", description: "追蹤管理異動" },
  { id: "security", marker: "安", label: "登入與安全", description: "Session 與登入事件" },
];

const sectionCopy: Record<AdminSection, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "ADMINISTRATION OVERVIEW", title: "管理總覽", description: "掌握帳號狀態、待處理事項與最近管理操作。" },
  users: { eyebrow: "USER ADMINISTRATION", title: "人員帳號", description: "建立帳號、調整角色並處理鎖定或停用狀態。" },
  roles: { eyebrow: "ROLES & PERMISSIONS", title: "角色與權限", description: "確認每一種角色可以查看及操作的系統功能。" },
  audit: { eyebrow: "AUDIT EVENTS", title: "操作紀錄", description: "保留帳號、登入與資料操作的完整追蹤資訊。" },
  security: { eyebrow: "SIGN-IN & SECURITY", title: "登入與安全", description: "查看使用中的登入階段、登入事件與安全規則。" },
};

const statusLabels: Record<UserStatus, string> = {
  active: "使用中",
  pending: "使用中",
  locked: "已鎖定",
  disabled: "已停用",
};

const permissions = [
  { label: "查看監測總覽", group: "監測", user: true, userpro: true, supervisor: true, admin: true },
  { label: "查看完整資料紀錄", group: "監測", user: false, userpro: true, supervisor: true, admin: true },
  { label: "登記現場量測", group: "資料", user: true, userpro: true, supervisor: true, admin: true },
  { label: "修改自己 30 分鐘內的提交", group: "資料", user: true, userpro: true, supervisor: true, admin: true },
  { label: "匯入 Excel 資料", group: "資料", user: false, userpro: true, supervisor: true, admin: true },
  { label: "更正任意量測紀錄", group: "資料", user: false, userpro: true, supervisor: true, admin: true },
  { label: "設定設備階軸", group: "設備", user: false, userpro: false, supervisor: true, admin: true },
  { label: "軟刪除紀錄", group: "高風險", user: false, userpro: true, supervisor: true, admin: true },
  { label: "從垃圾桶還原紀錄", group: "高風險", user: false, userpro: false, supervisor: true, admin: true },
  { label: "管理人員與角色", group: "管理", user: false, userpro: false, supervisor: false, admin: true },
  { label: "查看完整操作紀錄", group: "管理", user: false, userpro: false, supervisor: false, admin: true },
] as const;

const permissionRoles = ["user", "userpro", "supervisor", "admin"] as const;

const signInOutcomeLabels: Record<SignInOutcome, string> = {
  success: "登入成功",
  invalid_credentials: "密碼錯誤",
  account_not_found: "帳號不存在",
  account_disabled: "帳號已停用",
  account_locked: "帳號鎖定中",
  rate_limited: "嘗試過於頻繁",
};

const auditActionLabels: Record<string, string> = {
  "auth.login_success": "登入成功",
  "auth.login_failure": "登入失敗",
  "auth.logout": "登出",
  "user.created": "建立帳號",
  "user.role_changed": "變更角色",
  "user.status_changed": "停用／啟用帳號",
  "user.password_reset": "重設密碼",
  "lubrication.measurement_created": "新增油耗紀錄",
  "lubrication.excel_imported": "匯入油耗資料",
  "lubrication.measurement_corrected": "更正油耗紀錄",
  "lubrication.measurement_soft_deleted": "刪除油耗紀錄",
  "lubrication.measurement_restored": "還原油耗紀錄",
  "device_axle.created": "建立階軸設定",
  "device_axle.updated": "變更階軸設定",
};

const auditResourceLabels: Record<string, string> = {
  authentication: "登入驗證",
  user: "使用者帳號",
  import_batch: "油耗資料批次",
  measurement: "油耗紀錄",
  device_axle_profile: "設備階軸設定",
};

function auditActorLabel(username: string) {
  return username === "system" ? "系統" : `@${username}`;
}

function auditRoleLabel(role: string) {
  if (role === "system") return "系統";
  if (role === "anonymous") return "未驗證";
  if (role === "歷史未提供") return role;
  if (role === "user" || role === "userpro" || role === "supervisor" || role === "admin") {
    return getRoleDisplayLabel(role);
  }
  return role;
}

function auditActionLabel(action: string) {
  return auditActionLabels[action] ?? action;
}

function auditResourceLabel(event: StoredAuditEvent) {
  const category = auditResourceLabels[event.resourceType] ?? event.resourceType;
  const identity = event.resourceLabel ?? event.resourceId;
  return identity ? `${category}｜${identity}` : category;
}

function taipeiCalendarDate(value: string) {
  const date = parseStoredTimestamp(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatAuditSnapshot(value: unknown) {
  if (value === null || value === undefined) return "歷史未提供";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function userInitials(name: string) {
  return name.slice(0, 2);
}

function parseStoredTimestamp(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return new Date(normalized);
}

function formatStoredTimestamp(value: string, includeTime = false) {
  const date = parseStoredTimestamp(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
  }).format(date);
}

function storedUserToManagedUser(user: StoredApiUser, signedInUsername?: string): ManagedUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    status: user.status,
    lastLogin: user.lastLoginAt ? formatStoredTimestamp(user.lastLoginAt, true) : "尚未登入",
    createdAt: formatStoredTimestamp(user.createdAt),
    createdAtRaw: user.createdAt,
    createdBy: user.createdBy,
    sessions: user.username === signedInUsername ? 1 : 0,
  };
}

export default function AdminAreaPage() {
  const { user: authenticatedUser } = useAuthSession();
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [flash, setFlash] = useState("");
  const [formError, setFormError] = useState("");
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [accountAction, setAccountAction] = useState<"password" | "status" | "role" | null>(null);
  const [accountActionError, setAccountActionError] = useState("");
  const [signInEvents, setSignInEvents] = useState<StoredSignInEvent[]>([]);
  const [failedSignInCount, setFailedSignInCount] = useState(0);
  const [lockedAccountCount, setLockedAccountCount] = useState(0);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [securityError, setSecurityError] = useState("");
  const [auditEvents, setAuditEvents] = useState<StoredAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("all");
  const [auditRoleFilter, setAuditRoleFilter] = useState("all");
  const [auditResultFilter, setAuditResultFilter] = useState<"all" | "success" | "failure">("all");
  const [auditDateFrom, setAuditDateFrom] = useState("");
  const [auditDateTo, setAuditDateTo] = useState("");
  const [selectedAuditEvent, setSelectedAuditEvent] = useState<StoredAuditEvent | null>(null);

  const refreshAuditEvents = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/audit?limit=1000", { cache: "no-store", signal });
      const payload = await response.json() as { events?: StoredAuditEvent[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "無法讀取完整操作紀錄。");
      setAuditEvents(payload.events ?? []);
      setAuditError("");
    } catch (error) {
      if (signal?.aborted) return;
      setAuditError(error instanceof Error ? error.message : "無法讀取完整操作紀錄。");
    } finally {
      if (!signal?.aborted) setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/users", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { users?: StoredApiUser[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "無法讀取人員帳號。");
        return payload.users ?? [];
      })
      .then((storedUsers) => {
        setUsers(storedUsers.map((user) => storedUserToManagedUser(user, authenticatedUser?.username)));
        setAccountsError("");
        setAccountsLoading(false);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setAccountsError(error instanceof Error ? error.message : "無法讀取人員帳號。");
        setAccountsLoading(false);
      });
    return () => controller.abort();
  }, [authenticatedUser?.username]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/audit?limit=1000", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { events?: StoredAuditEvent[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "無法讀取完整操作紀錄。");
        return payload.events ?? [];
      })
      .then((events) => {
        setAuditEvents(events);
        setAuditError("");
        setAuditLoading(false);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setAuditError(error instanceof Error ? error.message : "無法讀取完整操作紀錄。");
        setAuditLoading(false);
      });
    return () => controller.abort();
  }, [authenticatedUser?.username]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/security", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as {
          events?: StoredSignInEvent[];
          failedCount24h?: number;
          lockedCount?: number;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "無法讀取登入安全紀錄。");
        return payload;
      })
      .then((payload) => {
        setSignInEvents(payload.events ?? []);
        setFailedSignInCount(payload.failedCount24h ?? 0);
        setLockedAccountCount(payload.lockedCount ?? 0);
        setSecurityError("");
        setSecurityLoading(false);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSecurityError(error instanceof Error ? error.message : "無法讀取登入安全紀錄。");
        setSecurityLoading(false);
      });
    return () => controller.abort();
  }, [authenticatedUser?.username]);

  const activeUsers = users.filter((user) => user.status === "active").length;
  const attentionUsers = users.filter((user) => user.status === "locked" || user.status === "disabled");
  const userCount = users.filter((user) => user.role === "user" && user.status !== "disabled").length;
  const userproCount = users.filter((user) => user.role === "userpro" && user.status !== "disabled").length;
  const supervisorCount = users.filter((user) => user.role === "supervisor" && user.status !== "disabled").length;
  const adminCount = users.filter((user) => user.role === "admin" && user.status !== "disabled").length;
  const activeSessions = users.reduce((sum, user) => sum + user.sessions, 0);
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const currentSection = sectionCopy[activeSection];

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery = !normalizedQuery || `${user.name} ${user.username} ${user.id}`.toLowerCase().includes(normalizedQuery);
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesStatus = statusFilter === "all" || user.status === statusFilter;
      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [query, roleFilter, statusFilter, users]);

  const auditActionOptions = useMemo(() => [...new Set(auditEvents.map((event) => event.action))]
    .sort((left, right) => auditActionLabel(left).localeCompare(auditActionLabel(right), "zh-Hant")), [auditEvents]);

  const auditRoleOptions = useMemo(() => [...new Set(auditEvents.map((event) => event.actorRole))]
    .sort((left, right) => auditRoleLabel(left).localeCompare(auditRoleLabel(right), "zh-Hant")), [auditEvents]);

  const filteredAuditEvents = useMemo(() => {
    const normalizedQuery = auditQuery.trim().toLowerCase();
    return auditEvents.filter((event) => {
      const searchable = [
        event.actorUsername,
        event.sourceIp,
        auditActionLabel(event.action),
        event.action,
        auditResourceLabel(event),
        event.resourceId,
        event.reason,
      ].filter(Boolean).join(" ").toLowerCase();
      const calendarDate = taipeiCalendarDate(event.occurredAt);
      return (!normalizedQuery || searchable.includes(normalizedQuery))
        && (auditActionFilter === "all" || event.action === auditActionFilter)
        && (auditRoleFilter === "all" || event.actorRole === auditRoleFilter)
        && (auditResultFilter === "all" || event.result === auditResultFilter)
        && (!auditDateFrom || calendarDate >= auditDateFrom)
        && (!auditDateTo || calendarDate <= auditDateTo);
    });
  }, [auditActionFilter, auditDateFrom, auditDateTo, auditEvents, auditQuery, auditResultFilter, auditRoleFilter]);

  const openSection = (section: AdminSection) => {
    setActiveSection(section);
    setFlash("");
  };

  const openUser = (userId: string) => {
    setSelectedUserId(userId);
    setFlash("");
    setResetPasswordOpen(false);
    setAccountActionError("");
  };

  const closeUser = () => {
    setSelectedUserId(null);
    setResetPasswordOpen(false);
    setAccountActionError("");
  };

  const replaceStoredUser = (storedUser: StoredApiUser) => {
    const managedUser = storedUserToManagedUser(storedUser, authenticatedUser?.username);
    setUsers((current) => current.map((user) => user.id === managedUser.id ? managedUser : user));
    return managedUser;
  };

  const patchSelectedUser = async (payload: Record<string, unknown>) => {
    if (!selectedUser) throw new Error("尚未選取人員帳號。");
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selectedUser.id, ...payload }),
    });
    const result = await response.json() as { user?: StoredApiUser; error?: string };
    if (!response.ok || !result.user) throw new Error(result.error || "帳號更新失敗。");
    return replaceStoredUser(result.user);
  };

  const resetSelectedUserPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUser || accountAction) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("newPassword") ?? "");
    const confirmation = String(form.get("confirmPassword") ?? "");
    if (!password) {
      setAccountActionError("請輸入新的登入密碼。");
      return;
    }
    if (password !== confirmation) {
      setAccountActionError("兩次輸入的密碼不一致。");
      return;
    }
    setAccountAction("password");
    setAccountActionError("");
    try {
      const updatedUser = await patchSelectedUser({ action: "reset_password", password });
      void refreshAuditEvents();
      formElement.reset();
      closeUser();
      setFlash(`${updatedUser.name} 的登入密碼已更新，可立即使用新密碼登入。`);
    } catch (error) {
      setAccountActionError(error instanceof Error ? error.message : "密碼重設失敗。");
    } finally {
      setAccountAction(null);
    }
  };

  const toggleSelectedUserStatus = async () => {
    if (!selectedUser || accountAction) return;
    const nextStatus = selectedUser.status === "disabled" || selectedUser.status === "locked"
      ? "active"
      : "disabled";
    setAccountAction("status");
    setAccountActionError("");
    try {
      const updatedUser = await patchSelectedUser({ action: "set_status", status: nextStatus });
      void refreshAuditEvents();
      closeUser();
      setFlash(nextStatus === "disabled"
        ? `${updatedUser.name} 的帳號已停用，現在無法登入。`
        : `${updatedUser.name} 的帳號已重新啟用。`);
    } catch (error) {
      setAccountActionError(error instanceof Error ? error.message : "帳號狀態更新失敗。");
    } finally {
      setAccountAction(null);
    }
  };

  const changeSelectedUserRole = async (role: UserRole) => {
    if (!selectedUser || role === selectedUser.role || accountAction) return;
    setAccountAction("role");
    setAccountActionError("");
    try {
      const updatedUser = await patchSelectedUser({ action: "set_role", role });
      void refreshAuditEvents();
      closeUser();
      setFlash(`${updatedUser.name} 的角色已更新為 ${getRoleDisplayLabel(updatedUser.role)}。`);
    } catch (error) {
      setAccountActionError(error instanceof Error ? error.message : "角色更新失敗。");
    } finally {
      setAccountAction(null);
    }
  };

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const username = String(form.get("username") ?? "").trim().toLowerCase();
    const role = String(form.get("role") ?? "user") as UserRole;
    const password = String(form.get("password") ?? "");

    if (!username || !password) {
      setFormError("請填寫登入帳號與密碼。");
      return;
    }
    if (users.some((user) => user.username.toLowerCase() === username)) {
      setFormError("這個登入帳號已經存在。");
      return;
    }

    setCreatingAccount(true);
    setFormError("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, role, password }),
      });
      const payload = await response.json() as { user?: StoredApiUser; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error || "帳號建立失敗。");
      const newUser = storedUserToManagedUser(payload.user, authenticatedUser?.username);
      setUsers((current) => [newUser, ...current]);
      void refreshAuditEvents();
      formElement.reset();
      setIsCreateOpen(false);
      setActiveSection("users");
      setFlash(`${username} 的帳號已儲存，重新整理後仍會保留。`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "帳號建立失敗。");
    } finally {
      setCreatingAccount(false);
    }
  };

  return (
    <main className="app-shell admin-area-page">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark admin-brand-mark" aria-hidden="true"><span></span><span></span></div>
          <div><p className="eyebrow">NEW TAIPEI METRO · O&amp;M</p><h1>環狀線鋼軌狀態監測中心</h1></div>
        </div>
        <nav className="topnav" aria-label="主要功能">
          <Link href="/" className="nav-item">潤滑設備總覽</Link>
          <a href="/wear" className="nav-item">正面軌道總覽</a>
          <a href="/side-wear" className="nav-item">側面軌道總覽</a>
          <AdminNavItem active />
        </nav>
        <SessionMenu />
      </header>

      <section className="page-content admin-console-content">
        <div className="admin-console-layout">
          <aside className="admin-sidebar">
            <div className="admin-sidebar-title">
              <span aria-hidden="true">A</span>
              <div><strong>管理中心</strong><small>Administration</small></div>
            </div>
            <nav aria-label="管理區域功能">
              {sectionItems.map((item) => (
                <button key={item.id} type="button" className={activeSection === item.id ? "active" : ""} onClick={() => openSection(item.id)} aria-current={activeSection === item.id ? "page" : undefined}>
                  <span className="admin-sidebar-marker" aria-hidden="true">{item.marker}</span>
                  <span><strong>{item.label}</strong><small>{item.description}</small></span>
                  <b aria-hidden="true">›</b>
                </button>
              ))}
            </nav>
            <div className="admin-sidebar-session">
              <span className="admin-session-dot" aria-hidden="true"></span>
              <div><strong>管理工作階段</strong><small>最近驗證：今天 09:18</small></div>
            </div>
          </aside>

          <section className="admin-console-main">
            <header className="admin-content-header">
              <div><p className="eyebrow dark">{currentSection.eyebrow}</p><h2>{currentSection.title}</h2><p>{currentSection.description}</p></div>
              <button type="button" className="admin-primary-button" onClick={() => { setIsCreateOpen(true); setFormError(""); }} disabled={accountsLoading}>＋ 新增帳號</button>
            </header>

            {flash ? <div className="admin-flash" role="status"><span aria-hidden="true">✓</span>{flash}<button type="button" onClick={() => setFlash("")} aria-label="關閉訊息">×</button></div> : null}
            {accountsError ? <div className="admin-form-error admin-account-load-error" role="alert">{accountsError}</div> : null}

            {activeSection === "overview" ? (
              <div className="admin-section-stack">
                <section className="admin-kpi-grid" aria-label="帳號狀態摘要">
                  <article><span className="admin-kpi-icon active" aria-hidden="true">人</span><div><small>使用中帳號</small><strong>{activeUsers}</strong><p>共 {users.length} 個帳號</p></div></article>
                  <article><span className="admin-kpi-icon attention" aria-hidden="true">!</span><div><small>帳號異常</small><strong>{attentionUsers.length}</strong><p>遭鎖定或由 ADMIN 停用</p></div></article>
                  <article><span className="admin-kpi-icon supervisor" aria-hidden="true">P</span><div><small>POWER USER</small><strong>{supervisorCount}</strong><p>可執行進階資料操作</p></div></article>
                  <article><span className="admin-kpi-icon session" aria-hidden="true">●</span><div><small>使用中 Session</small><strong>{activeSessions}</strong><p>跨 {activeSessions} 個帳號工作階段</p></div></article>
                </section>

                <div className="admin-overview-grid">
                  <section className="admin-panel" aria-labelledby="attention-title">
                    <header className="admin-panel-heading"><div><span className="panel-kicker">ACCOUNT ALERTS</span><h3 id="attention-title">帳號安全提醒</h3></div><button type="button" onClick={() => openSection("users")}>管理帳號</button></header>
                    <div className="admin-attention-list">
                      {attentionUsers.map((user) => (
                        <button type="button" key={user.id} onClick={() => { openSection("users"); openUser(user.id); }}>
                          <span className={`admin-user-avatar ${user.role}`} aria-hidden="true">{userInitials(user.name)}</span>
                          <span><strong>{user.name}</strong><small>@{user.username} · {statusLabels[user.status]}</small></span>
                          <span className={`admin-status ${user.status}`}>{statusLabels[user.status]}</span>
                          <b aria-hidden="true">›</b>
                        </button>
                      ))}
                    </div>
                    {!accountsLoading && attentionUsers.length === 0 ? <div className="admin-empty compact"><strong>目前沒有帳號異常</strong><p>遭鎖定或停用的帳號會出現在這裡。</p></div> : null}
                  </section>

                  <section className="admin-panel" aria-labelledby="recent-audit-title">
                    <header className="admin-panel-heading"><div><span className="panel-kicker">RECENT ACTIVITY</span><h3 id="recent-audit-title">最近系統操作</h3></div><button type="button" onClick={() => openSection("audit")}>完整紀錄</button></header>
                    <div className="admin-recent-list">
                      {auditEvents.slice(0, 4).map((event) => (
                        <div key={event.id}><span className={`admin-event-dot ${event.result}`} aria-hidden="true"></span><div><strong>{auditActionLabel(event.action)}</strong><p>{auditActorLabel(event.actorUsername)} · {auditResourceLabel(event)}</p></div><time>{formatStoredTimestamp(event.occurredAt, true)}</time></div>
                      ))}
                    </div>
                  </section>
                </div>

                <section className="admin-health-strip" aria-label="管理系統狀態">
                  <div><span className="pulse-dot" aria-hidden="true"></span><strong>帳號服務正常</strong><small>最後檢查：剛剛</small></div>
                  <div><span aria-hidden="true">DB</span><strong>D1 資料庫</strong><small>{accountsError ? "帳號資料讀取失敗" : accountsLoading ? "同步中" : "連線正常"}</small></div>
                  <div><span aria-hidden="true">LOG</span><strong>稽核紀錄</strong><small>{auditError ? "讀取失敗" : auditLoading ? "同步中" : `${auditEvents.length} 筆可查`}</small></div>
                  <button type="button" onClick={() => openSection("security")}>查看登入安全 →</button>
                </section>
              </div>
            ) : null}

            {activeSection === "users" ? (
              <section className="admin-panel admin-users-panel" aria-labelledby="users-table-title">
                <div className="admin-toolbar">
                  <label className="admin-search"><span className="visually-hidden">搜尋帳號</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋姓名、帳號或編號" /></label>
                  <label><span>角色</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as UserRole | "all")}><option value="all">全部角色</option><option value="user">USER</option><option value="userpro">AD USER</option><option value="supervisor">POWER USER</option><option value="admin">ADMIN</option></select></label>
                  <label><span>狀態</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as UserStatus | "all")}><option value="all">全部狀態</option><option value="active">使用中</option><option value="locked">已鎖定</option><option value="disabled">已停用</option></select></label>
                  <span className="admin-result-count">{filteredUsers.length} / {users.length} 人</span>
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <caption id="users-table-title" className="visually-hidden">人員帳號清單</caption>
                    <thead><tr><th>人員</th><th>登入帳號</th><th>角色</th><th>狀態</th><th>最後登入</th><th>建立日期</th><th><span className="visually-hidden">操作</span></th></tr></thead>
                    <tbody>
                      {filteredUsers.map((user) => (
                        <tr key={user.id}>
                          <td><div className="admin-user-cell"><span className={`admin-user-avatar ${user.role}`} aria-hidden="true">{userInitials(user.name)}</span><div><strong>{user.name}</strong><small>{user.id}</small></div></div></td>
                          <td><strong className="admin-username">@{user.username}</strong></td>
                          <td><span className={`admin-role-badge ${user.role}`}>{getRoleDisplayLabel(user.role)}</span></td>
                          <td><span className={`admin-status ${user.status}`}>{statusLabels[user.status]}</span></td>
                          <td>{user.lastLogin}</td><td>{user.createdAt}</td>
                          <td><button type="button" className="admin-row-action" onClick={() => openUser(user.id)}>管理</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!filteredUsers.length ? <div className="admin-empty"><strong>{accountsLoading ? "正在讀取人員帳號" : "找不到符合條件的帳號"}</strong><p>{accountsLoading ? "正在與本機 D1 同步。" : "請調整搜尋文字或篩選條件。"}</p></div> : null}
              </section>
            ) : null}

            {activeSection === "roles" ? (
              <div className="admin-section-stack">
                <section className="admin-role-overview" aria-label="角色摘要">
                  <article className="user"><span>U</span><div><strong className="role-display-badge user">USER</strong><small>一般查詢與現場登記</small></div><b>{userCount} 人</b></article>
                  <article className="userpro"><span>AD</span><div><strong className="role-display-badge userpro">AD USER</strong><small>匯入、更正與軟刪除</small></div><b>{userproCount} 人</b></article>
                  <article className="supervisor"><span>P</span><div><strong className="role-display-badge supervisor">POWER USER</strong><small>進階資料操作</small></div><b>{supervisorCount} 人</b></article>
                  <article className="admin"><span>A</span><div><strong className="role-display-badge admin">ADMIN</strong><small>系統與帳號管理</small></div><b>{adminCount} 人</b></article>
                </section>
                <section className="admin-panel" aria-labelledby="permission-title">
                  <header className="admin-panel-heading"><div><span className="panel-kicker">PERMISSION MATRIX</span><h3 id="permission-title">功能權限矩陣</h3></div><span className="admin-readonly-badge">第一版固定角色</span></header>
                  <div className="admin-table-wrap">
                    <table className="admin-table permission-table">
                      <thead><tr><th>功能</th><th>分類</th>{permissionRoles.map((role) => <th key={role}><span className={`role-display-badge ${role}`}>{getRoleDisplayLabel(role)}</span></th>)}</tr></thead>
                      <tbody>{permissions.map((permission) => <tr key={permission.label}><td><strong>{permission.label}</strong></td><td><span className="admin-permission-group">{permission.group}</span></td>{permissionRoles.map((role) => <td key={role}><span className={permission[role] ? "permission-yes" : "permission-no"}>{permission[role] ? "✓" : "—"}</span></td>)}</tr>)}</tbody>
                    </table>
                  </div>
                  <p className="admin-panel-footnote"><strong>USER</strong> 只能在「我的近期提交」修改本人 30 分鐘內的現場紀錄；逾時須由 AD USER 以上角色更正。</p>
                </section>
              </div>
            ) : null}

            {activeSection === "audit" ? (
              <section className="admin-panel admin-audit-panel" aria-labelledby="audit-title">
                <header className="admin-panel-heading"><div><span className="panel-kicker">AUDIT TRAIL</span><h3 id="audit-title">完整操作事件</h3></div><button type="button" className="admin-secondary-button" onClick={() => { setAuditLoading(true); void refreshAuditEvents(); }} disabled={auditLoading}>{auditLoading ? "更新中…" : "重新整理"}</button></header>
                <div className="admin-audit-toolbar">
                  <label className="admin-search"><span>關鍵字</span><input value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} placeholder="帳號、IP、動作或操作對象" /></label>
                  <label><span>動作</span><select value={auditActionFilter} onChange={(event) => setAuditActionFilter(event.target.value)}><option value="all">全部動作</option>{auditActionOptions.map((action) => <option key={action} value={action}>{auditActionLabel(action)}</option>)}</select></label>
                  <label><span>操作者角色</span><select value={auditRoleFilter} onChange={(event) => setAuditRoleFilter(event.target.value)}><option value="all">全部角色</option>{auditRoleOptions.map((role) => <option key={role} value={role}>{auditRoleLabel(role)}</option>)}</select></label>
                  <label><span>結果</span><select value={auditResultFilter} onChange={(event) => setAuditResultFilter(event.target.value as typeof auditResultFilter)}><option value="all">全部結果</option><option value="success">成功</option><option value="failure">失敗</option></select></label>
                  <label><span>開始日期</span><input type="date" value={auditDateFrom} max={auditDateTo || undefined} onChange={(event) => setAuditDateFrom(event.target.value)} /></label>
                  <label><span>結束日期</span><input type="date" value={auditDateTo} min={auditDateFrom || undefined} onChange={(event) => setAuditDateTo(event.target.value)} /></label>
                  <span className="admin-result-count">{filteredAuditEvents.length} / {auditEvents.length} 筆</span>
                </div>
                {auditError ? <div className="admin-form-error admin-audit-error" role="alert">{auditError}</div> : null}
                <div className="admin-table-wrap">
                  <table className="admin-table admin-audit-table">
                    <thead><tr><th>系統時間</th><th>操作者／角色</th><th>來源 IP</th><th>動作</th><th>操作對象</th><th>結果</th><th><span className="visually-hidden">詳情</span></th></tr></thead>
                    <tbody>{filteredAuditEvents.map((event) => (
                      <tr key={event.id}>
                        <td><time>{formatStoredTimestamp(event.occurredAt, true)}</time>{event.historical ? <small className="admin-legacy-label">舊紀錄</small> : null}</td>
                        <td><strong>{auditActorLabel(event.actorUsername)}</strong><small className="admin-audit-subtext">{auditRoleLabel(event.actorRole)}</small></td>
                        <td>{event.sourceIp}</td>
                        <td><strong>{auditActionLabel(event.action)}</strong></td>
                        <td>{auditResourceLabel(event)}</td>
                        <td><span className={`admin-audit-result ${event.result}`}>{event.result === "success" ? "成功" : "失敗"}</span></td>
                        <td><button type="button" className="admin-row-action" onClick={() => setSelectedAuditEvent(event)}>查看</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                {!auditLoading && !auditError && filteredAuditEvents.length === 0 ? <div className="admin-empty"><strong>找不到符合條件的操作紀錄</strong><p>請調整關鍵字、日期或篩選條件。</p></div> : null}
                <p className="admin-panel-footnote">新紀錄包含 IP、系統時間、操作者角色、操作對象與修改前後內容；舊資料無法回填的欄位會標示「歷史未提供」。密碼、密碼雜湊與 Session 憑證不寫入 LOG。</p>
              </section>
            ) : null}

            {activeSection === "security" ? (
              <div className="admin-section-stack">
                <section className="admin-security-grid" aria-label="登入安全摘要">
                  <article><span>SESSION</span><strong>{activeSessions} 個</strong><p>目前使用中的登入階段</p></article>
                  <article><span>FAILED SIGN-IN</span><strong>{securityLoading ? "—" : `${failedSignInCount} 次`}</strong><p>最近 24 小時失敗登入</p></article>
                  <article><span>LOCKED</span><strong>{securityLoading ? "—" : `${lockedAccountCount} 個`}</strong><p>因連續失敗而鎖定</p></article>
                </section>
                <div className="admin-overview-grid security-panels">
                  <section className="admin-panel" aria-labelledby="session-title">
                    <header className="admin-panel-heading"><div><span className="panel-kicker">ACTIVE SESSIONS</span><h3 id="session-title">使用中的登入階段</h3></div></header>
                    <div className="admin-session-list">{users.filter((user) => user.sessions > 0).map((user) => <div key={user.id}><span className={`admin-user-avatar ${user.role}`}>{userInitials(user.name)}</span><div><strong>{user.name}</strong><p>@{user.username} · Windows · 內部網路</p></div><small>{user.lastLogin}</small><button type="button" disabled>登出</button></div>)}</div>
                  </section>
                  <section className="admin-panel" aria-labelledby="policy-title">
                    <header className="admin-panel-heading"><div><span className="panel-kicker">SECURITY POLICY</span><h3 id="policy-title">預設登入規則</h3></div></header>
                    <dl className="admin-policy-list"><div><dt>連續失敗</dt><dd>5 次後鎖定 15 分鐘</dd></div><div><dt>登入有效時間</dt><dd>8 小時後重新登入</dd></div><div><dt>ADMIN 帳號</dt><dd>系統至少保留 1 位</dd></div></dl>
                  </section>
                </div>
                <section className="admin-panel" aria-labelledby="login-event-title">
                  <header className="admin-panel-heading"><div><span className="panel-kicker">SIGN-IN EVENTS</span><h3 id="login-event-title">近期登入事件</h3></div><span className="admin-readonly-badge">最近 24 小時</span></header>
                  {securityError ? <div className="admin-form-error" role="alert">{securityError}</div> : null}
                  <div className="admin-login-events">
                    {signInEvents.map((event) => <div key={event.id}><time>{formatStoredTimestamp(event.createdAt, true)}</time><strong>@{event.username}</strong><span>{event.source}</span><span>{signInOutcomeLabels[event.outcome]}</span><b className={event.success ? "success" : ""}>{event.success ? "成功" : "失敗"}</b></div>)}
                  </div>
                  {!securityLoading && !securityError && signInEvents.length === 0 ? <div className="admin-empty compact"><strong>目前沒有登入事件</strong><p>有人登入或輸入錯誤密碼後，紀錄會立即出現在這裡。</p></div> : null}
                </section>
              </div>
            ) : null}
          </section>
        </div>
      </section>

      {isCreateOpen ? (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsCreateOpen(false); }}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="create-account-title">
            <header><div><span className="panel-kicker">CREATE ACCOUNT</span><h3 id="create-account-title">新增人員帳號</h3><p>帳號名稱與登入名稱相同，建立後可直接登入。</p></div><button type="button" onClick={() => setIsCreateOpen(false)} aria-label="關閉新增帳號視窗">×</button></header>
            <form onSubmit={createUser}>
              <label><span>登入帳號／顯示名稱 <b>*</b></span><input name="username" autoFocus required placeholder="例如：operator01" autoComplete="off" /></label>
              <label><span>角色 <b>*</b></span><select name="role" defaultValue="user"><option value="user">USER－一般操作</option><option value="userpro">AD USER－匯入、更正與軟刪除</option><option value="supervisor">POWER USER－階軸設定與資料還原</option><option value="admin">ADMIN－系統與帳號管理</option></select></label>
              <label><span>登入密碼 <b>*</b></span><input name="password" type="password" required placeholder="由 ADMIN 自行設定" autoComplete="new-password" /></label>
              {formError ? <div className="admin-form-error" role="alert">{formError}</div> : null}
              <p className="admin-local-note">帳號會儲存至本機 D1；建立完成後可立即登入，重新整理也會保留。</p>
              <footer><button type="button" className="admin-secondary-button" onClick={() => setIsCreateOpen(false)} disabled={creatingAccount}>取消</button><button type="submit" className="admin-primary-button" disabled={creatingAccount}>{creatingAccount ? "建立中…" : "建立帳號"}</button></footer>
            </form>
          </section>
        </div>
      ) : null}

      {selectedUser ? (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !accountAction) closeUser(); }}>
          <aside className="admin-user-drawer" role="dialog" aria-modal="true" aria-labelledby="user-detail-title">
            <header><div><span className={`admin-user-avatar large ${selectedUser.role}`} aria-hidden="true">{userInitials(selectedUser.name)}</span><div><span className="panel-kicker">{selectedUser.id}</span><h3 id="user-detail-title">{selectedUser.name}</h3><p>@{selectedUser.username}</p></div></div><button type="button" onClick={closeUser} disabled={Boolean(accountAction)} aria-label="關閉人員帳號詳情">×</button></header>
            <div className="admin-user-detail-body">
              <dl><div><dt>目前狀態</dt><dd><span className={`admin-status ${selectedUser.status}`}>{statusLabels[selectedUser.status]}</span></dd></div><div><dt>最後登入</dt><dd>{selectedUser.lastLogin}</dd></div><div><dt>登入階段</dt><dd>{selectedUser.sessions} 個</dd></div><div><dt>建立日期</dt><dd>{selectedUser.createdAt}</dd></div></dl>
              <label><span>角色</span><select value={selectedUser.role} onChange={(event) => void changeSelectedUserRole(event.target.value as UserRole)} disabled={selectedUser.username === authenticatedUser?.username || Boolean(accountAction)}><option value="user">USER</option><option value="userpro">AD USER</option><option value="supervisor">POWER USER</option><option value="admin">ADMIN</option></select><small>{selectedUser.username === authenticatedUser?.username ? "目前登入的 ADMIN 不能降級自己的帳號。" : "選擇後會立即更新此人的系統權限。"}</small></label>
              <div className="admin-user-actions"><button type="button" onClick={() => { setResetPasswordOpen((current) => !current); setAccountActionError(""); }} disabled={Boolean(accountAction)}>{resetPasswordOpen ? "取消重設" : "重設密碼"}</button><button type="button" className={selectedUser.status === "disabled" || selectedUser.status === "locked" ? "success" : "danger"} onClick={() => void toggleSelectedUserStatus()} disabled={selectedUser.username === authenticatedUser?.username || Boolean(accountAction)}>{accountAction === "status" ? "處理中…" : selectedUser.status === "disabled" || selectedUser.status === "locked" ? "啟用帳號" : "停用帳號"}</button></div>
              {resetPasswordOpen ? <form className="admin-reset-password-form" onSubmit={resetSelectedUserPassword}><strong>設定新的登入密碼</strong><label><span>新密碼</span><input name="newPassword" type="password" required autoFocus autoComplete="new-password" /></label><label><span>再次輸入新密碼</span><input name="confirmPassword" type="password" required autoComplete="new-password" /></label><small>不限制長度或字元組合；儲存後舊密碼立即失效。</small><button type="submit" className="admin-primary-button" disabled={Boolean(accountAction)}>{accountAction === "password" ? "儲存中…" : "儲存新密碼"}</button></form> : null}
              {accountActionError ? <div className="admin-form-error" role="alert">{accountActionError}</div> : null}
            </div>
          </aside>
        </div>
      ) : null}

      {selectedAuditEvent ? (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedAuditEvent(null); }}>
          <aside className="admin-user-drawer admin-audit-drawer" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title">
            <header>
              <div><span className={`admin-event-dot ${selectedAuditEvent.result}`} aria-hidden="true"></span><div><span className="panel-kicker">AUDIT EVENT</span><h3 id="audit-detail-title">{auditActionLabel(selectedAuditEvent.action)}</h3><p>{selectedAuditEvent.id}</p></div></div>
              <button type="button" onClick={() => setSelectedAuditEvent(null)} aria-label="關閉操作紀錄詳情">×</button>
            </header>
            <div className="admin-user-detail-body admin-audit-detail-body">
              {selectedAuditEvent.historical ? <p className="admin-audit-history-note">此筆來自既有歷史資料；當時未保存的欄位無法回填。</p> : null}
              <dl>
                <div><dt>系統時間</dt><dd>{formatStoredTimestamp(selectedAuditEvent.occurredAt, true)}</dd></div>
                <div><dt>操作者</dt><dd>{auditActorLabel(selectedAuditEvent.actorUsername)}</dd></div>
                <div><dt>操作者角色</dt><dd>{auditRoleLabel(selectedAuditEvent.actorRole)}</dd></div>
                <div><dt>來源 IP</dt><dd>{selectedAuditEvent.sourceIp}</dd></div>
                <div><dt>操作對象</dt><dd>{auditResourceLabel(selectedAuditEvent)}</dd></div>
                <div><dt>結果</dt><dd><span className={`admin-audit-result ${selectedAuditEvent.result}`}>{selectedAuditEvent.result === "success" ? "成功" : "失敗"}</span></dd></div>
                <div><dt>原因／備註</dt><dd>{selectedAuditEvent.reason ?? "未提供"}</dd></div>
                <div><dt>請求識別碼</dt><dd className="admin-audit-code">{selectedAuditEvent.requestId}</dd></div>
                <div><dt>裝置資訊</dt><dd>{selectedAuditEvent.userAgent ?? (selectedAuditEvent.historical ? "歷史未提供" : "未提供")}</dd></div>
              </dl>
              <section className="admin-audit-change" aria-labelledby="audit-before-title"><span id="audit-before-title">修改前</span><pre>{formatAuditSnapshot(selectedAuditEvent.before)}</pre></section>
              <section className="admin-audit-change after" aria-labelledby="audit-after-title"><span id="audit-after-title">修改後</span><pre>{formatAuditSnapshot(selectedAuditEvent.after)}</pre></section>
              {selectedAuditEvent.errorCode ? <div className="admin-form-error">錯誤代碼：{selectedAuditEvent.errorCode}</div> : null}
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
