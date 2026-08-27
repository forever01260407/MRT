"use client";

import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "auto";
      size: "flexible";
      appearance: "interaction-only";
      callback(token: string): void;
      "expired-callback"(): void;
      "error-callback"(): void;
    },
  ): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type TurnstileConfig = {
  siteKey?: string;
  action?: string;
  error?: string;
};

type TurnstileWidgetProps = {
  onTokenChange(token: string | null): void;
};

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-mrt-turnstile]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstile script failed to load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.mrtTurnstile = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile script failed to load.")), { once: true });
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

export function TurnstileWidget({ onTokenChange }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("正在進行 Cloudflare 安全驗證…");

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | null = null;
    const controller = new AbortController();

    onTokenChange(null);

    void Promise.all([
      fetch("/api/turnstile", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const config = await response.json() as TurnstileConfig;
        if (!response.ok || !config.siteKey || !config.action) {
          throw new Error(config.error ?? "安全驗證設定無法載入。");
        }
        return { siteKey: config.siteKey, action: config.action };
      }),
      loadTurnstileScript(),
    ]).then(([config]) => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: config.siteKey,
        action: config.action,
        theme: "auto",
        size: "flexible",
        appearance: "interaction-only",
        callback(token) {
          if (cancelled) return;
          onTokenChange(token);
          setStatus("ready");
          setMessage("安全驗證完成，可以送出現場紀錄。");
        },
        "expired-callback"() {
          if (cancelled) return;
          onTokenChange(null);
          setStatus("loading");
          setMessage("安全驗證已逾時，正在重新驗證…");
        },
        "error-callback"() {
          if (cancelled) return;
          onTokenChange(null);
          setStatus("error");
          setMessage("安全驗證未完成，請檢查網路後再試。");
        },
      });
    }).catch((error) => {
      if (cancelled || controller.signal.aborted) return;
      onTokenChange(null);
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "安全驗證無法載入。");
    });

    return () => {
      cancelled = true;
      controller.abort();
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onTokenChange]);

  return (
    <div className={`turnstile-verification ${status}`}>
      <div ref={containerRef} className="turnstile-widget" aria-hidden={status === "ready"} />
      <div className="turnstile-status" role="status" aria-live="polite">
        <span aria-hidden="true">{status === "ready" ? "✓" : status === "error" ? "!" : "↻"}</span>
        {message}
      </div>
    </div>
  );
}
