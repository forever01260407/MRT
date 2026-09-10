"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { getRoleDisplayLabel, getRoleDisplayMark } from "../lib/rolePresentation";
import type { RoleCode } from "../lib/rolePresentation";

type SessionUser = {
  username: string;
  name: string;
  role: RoleCode;
  expiresAt: number;
};

type AuthContextValue = {
  user: SessionUser | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true });

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json() as { user?: SessionUser };
        return payload.user ?? null;
      })
      .catch(() => null)
      .then((nextUser) => {
        if (!active) return;
        setUser(nextUser);
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
}

export function useAuthSession() {
  return useContext(AuthContext);
}

export function AdminNavItem({ active = false }: { active?: boolean }) {
  const { user, loading } = useAuthSession();
  if (loading || (user?.role !== "admin" && user?.role !== "root")) return null;
  return (
    <a
      href="/admin-area"
      className={`nav-item admin-nav-item ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      data-requires-role="admin-or-root"
    >
      ADMIN AREA
    </a>
  );
}

export function SessionMenu() {
  const { user, loading } = useAuthSession();
  const [signingOut, setSigningOut] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwordSubmitting) return;
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (!currentPassword || !newPassword) {
      setPasswordError("請輸入目前密碼及新密碼。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("兩次輸入的新密碼不一致。");
      return;
    }
    setPasswordSubmitting(true);
    setPasswordError("");
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "密碼更新失敗，請稍後再試。");
      window.location.assign("/login?passwordChanged=1");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "密碼更新失敗，請稍後再試。");
      setPasswordSubmitting(false);
    }
  };

  if (loading) return <div className="session-menu session-menu-loading" aria-label="正在讀取登入身分"></div>;
  if (!user) return null;

  return (
    <>
      <div className="session-menu">
        <span className={`session-role-mark ${user.role}`} aria-hidden="true">{getRoleDisplayMark(user.role)}</span>
        <span className="session-identity">
          <strong>{user.name}</strong>
          <small><span className={`role-display-badge ${user.role}`}>{getRoleDisplayLabel(user.role)}</span><span>@{user.username}</span></small>
        </span>
        <span className="session-actions">
          {user.role !== "root" ? <button type="button" onClick={() => { setPasswordError(""); setPasswordOpen(true); }}>更換密碼</button> : null}
          <button type="button" onClick={signOut} disabled={signingOut}>{signingOut ? "登出中" : "登出"}</button>
        </span>
      </div>
      {passwordOpen ? (
        <div className="account-password-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !passwordSubmitting) setPasswordOpen(false); }}>
          <section className="account-password-dialog" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
            <header><div><span>ACCOUNT SECURITY</span><h2 id="change-password-title">更換自己的密碼</h2><p>@{user.username}</p></div><button type="button" onClick={() => setPasswordOpen(false)} disabled={passwordSubmitting} aria-label="關閉更換密碼視窗">×</button></header>
            <form onSubmit={changePassword}>
              <label><span>目前密碼</span><input name="currentPassword" type="password" required autoFocus autoComplete="current-password" /></label>
              <label><span>新密碼</span><input name="newPassword" type="password" required autoComplete="new-password" /></label>
              <label><span>再次輸入新密碼</span><input name="confirmPassword" type="password" required autoComplete="new-password" /></label>
              <p className="account-password-note">密碼不限制長度或字元組合，但不能與目前密碼相同。更新後所有登入階段都會失效，請使用新密碼重新登入。</p>
              {passwordError ? <div className="account-password-error" role="alert">{passwordError}</div> : null}
              <footer><button type="button" onClick={() => setPasswordOpen(false)} disabled={passwordSubmitting}>取消</button><button type="submit" disabled={passwordSubmitting}>{passwordSubmitting ? "更新中…" : "更新密碼"}</button></footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
