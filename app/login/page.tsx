"use client";

import { useState } from "react";
import type { FormEvent } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "登入失敗，請稍後再試。");
      const requestedPath = new URLSearchParams(window.location.search).get("next");
      const safePath = requestedPath?.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/";
      window.location.assign(safePath);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "登入失敗，請稍後再試。");
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-brand-panel" aria-label="系統介紹">
        <div className="login-brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span></span><span></span></div>
          <div><p className="eyebrow">NEW TAIPEI METRO · O&amp;M</p><h1>環狀線鋼軌<br />狀態監測中心</h1></div>
        </div>
        <div className="login-brand-copy">
          <span className="login-system-state"><i></i> INTERNAL SYSTEM</span>
          <h2>資料從登入開始受到保護。</h2>
          <p>登入後會依照帳號角色顯示可使用的功能；管理中心僅限 ADMIN 與 ROOT 進入。</p>
        </div>
        <footer>NEW TAIPEI METRO · OPERATIONS &amp; MAINTENANCE</footer>
      </section>

      <section className="login-form-panel">
        <div className="login-card">
          <header><span className="login-card-icon" aria-hidden="true">↗</span><p className="eyebrow dark">SECURE SIGN IN</p><h2>登入監測中心</h2><p>請使用系統帳號繼續。</p></header>
          <form onSubmit={signIn}>
            <label><span>帳號</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required placeholder="輸入帳號" /></label>
            <label><span>密碼</span><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required placeholder="輸入密碼" /></label>
            {error ? <div className="login-error" role="alert"><span aria-hidden="true">!</span>{error}</div> : null}
            <button type="submit" className="login-submit" disabled={submitting}>{submitting ? "驗證中…" : "登入系統"}<span aria-hidden="true">→</span></button>
          </form>

          <p className="login-footnote">登入階段最長 8 小時；登出後需重新輸入帳號密碼。</p>
        </div>
      </section>
    </main>
  );
}
