"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
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
  if (loading || user?.role !== "admin") return null;
  return (
    <a
      href="/admin-area"
      className={`nav-item admin-nav-item ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      data-requires-role="admin"
    >
      ADMIN AREA
    </a>
  );
}

export function SessionMenu() {
  const { user, loading } = useAuthSession();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  };

  if (loading) return <div className="session-menu session-menu-loading" aria-label="正在讀取登入身分"></div>;
  if (!user) return null;

  return (
    <div className="session-menu">
      <span className={`session-role-mark ${user.role}`} aria-hidden="true">{getRoleDisplayMark(user.role)}</span>
      <span className="session-identity">
        <strong>{user.name}</strong>
        <small><span className={`role-display-badge ${user.role}`}>{getRoleDisplayLabel(user.role)}</span><span>@{user.username}</span></small>
      </span>
      <button type="button" onClick={signOut} disabled={signingOut}>{signingOut ? "登出中" : "登出"}</button>
    </div>
  );
}
