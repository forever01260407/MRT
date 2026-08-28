import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";
const CLOUDFLARE_WORKERS_DATABASE_ID =
  "5f8b3550-74b0-4ada-a067-d0e99a4e490a";
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

const { d1, r2 } = hostingConfig;
const isCloudflareWorkersBuild = process.env.WORKERS_CI === "1";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ command, mode }) => {
  const localEnv = loadEnv(mode, process.cwd(), "");
  const localBindingConfig = {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: isCloudflareWorkersBuild
              ? "mrt-lubrication-monitor"
              : "site-creator-d1",
            database_id: isCloudflareWorkersBuild
              ? CLOUDFLARE_WORKERS_DATABASE_ID
              : SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: "site-creator-r2",
          },
        ]
      : [],
    ratelimits: [
      {
        name: "MANUAL_ENTRY_RATE_LIMITER",
        namespace_id: "1001",
        simple: { limit: 5, period: 60 as const },
      },
      {
        name: "DELETE_RATE_LIMITER",
        namespace_id: "1002",
        simple: { limit: 5, period: 60 as const },
      },
    ],
    ...(command === "serve"
      ? {
          vars: {
            TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
            TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
            ...(localEnv.DELETE_PASSWORD
              ? { DELETE_PASSWORD: localEnv.DELETE_PASSWORD }
              : {}),
          },
        }
      : { keep_vars: true }),
  };

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
