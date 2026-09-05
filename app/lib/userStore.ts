import { getD1 } from "../../db";
import { createPasswordCredential, verifyPassword } from "./auth";
import type { AuthRole, PasswordCredential } from "./auth";

type UserStatus = "active" | "pending" | "locked" | "disabled";
type Database = Awaited<ReturnType<typeof getD1>>;

export type SignInOutcome = "success" | "invalid_credentials" | "account_not_found" | "account_disabled" | "account_locked" | "rate_limited";

export type SignInContext = {
  source: string;
  userAgent?: string;
};

export type SignInEvent = {
  id: string;
  username: string;
  success: boolean;
  outcome: SignInOutcome;
  source: string;
  createdAt: string;
};

type StoredUserRow = {
  id: string;
  name: string;
  username: string;
  role: AuthRole;
  status: UserStatus;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  force_password_change: number;
  last_login_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type StoredUser = {
  id: string;
  name: string;
  username: string;
  role: AuthRole;
  status: UserStatus;
  lastLoginAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const USERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  force_password_change INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_role_valid CHECK(role IN ('user', 'supervisor', 'admin')),
  CONSTRAINT users_status_valid CHECK(status IN ('active', 'pending', 'locked', 'disabled')),
  CONSTRAINT users_force_password_change_valid CHECK(force_password_change IN (0, 1)),
  CONSTRAINT users_password_iterations_positive CHECK(password_iterations > 0)
)`;

const USERS_USERNAME_INDEX_SQL = "CREATE UNIQUE INDEX IF NOT EXISTS users_username_uidx ON users(username COLLATE NOCASE)";
const SIGN_IN_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS sign_in_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  username TEXT NOT NULL COLLATE NOCASE,
  success INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  source TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sign_in_events_success_valid CHECK(success IN (0, 1)),
  CONSTRAINT sign_in_events_outcome_valid CHECK(outcome IN ('success', 'invalid_credentials', 'account_not_found', 'account_disabled', 'account_locked', 'rate_limited')),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`;
const SIGN_IN_EVENTS_USERNAME_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_sign_in_events_username_created_at ON sign_in_events(username, created_at)";
const SIGN_IN_EVENTS_CREATED_AT_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_sign_in_events_created_at ON sign_in_events(created_at)";

const initialAccounts: Array<{
  id: string;
  username: string;
  role: AuthRole;
  password: PasswordCredential;
}> = [
  {
    id: "USR-001",
    username: "admin",
    role: "admin",
    password: { salt: "TpjBMQsHOWemb9lFj2dPrA", hash: "6Cbja9i01yPn0_PfiXCr1xyIW63HGX_mZYFQj67gvyg", iterations: 120_000 },
  },
  {
    id: "USR-002",
    username: "supervisor",
    role: "supervisor",
    password: { salt: "X8I_SfTQ4IxR1Hx-YpIheA", hash: "0OjljRLm2i1CnaMD95MaxNEmvkDhMNXUcz_3CmxO5EU", iterations: 120_000 },
  },
  {
    id: "USR-003",
    username: "user",
    role: "user",
    password: { salt: "LVTgZ_ofzRIXU094T9nryA", hash: "Dr1YQmU_XIW2irnQfvaKozWJXRZiLGcynIp9HYRCMyI", iterations: 120_000 },
  },
];

let usersTableReady: Promise<void> | null = null;

function publicUser(row: StoredUserRow): StoredUser {
  return {
    id: row.id,
    name: row.username,
    username: row.username,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DuplicateUsernameError extends Error {
  constructor() {
    super("這個登入帳號已經存在。");
    this.name = "DuplicateUsernameError";
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super("找不到這個人員帳號。");
    this.name = "UserNotFoundError";
  }
}

export class AccountProtectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountProtectionError";
  }
}

async function findUserById(database: Database, userId: string) {
  const row = await database.prepare(
    `SELECT id, name, username, role, status, password_hash, password_salt,
      password_iterations, force_password_change, last_login_at, created_by, created_at, updated_at
    FROM users WHERE id = ? LIMIT 1`,
  ).bind(userId).first<StoredUserRow>();
  if (!row) throw new UserNotFoundError();
  return row;
}

async function assertAdminCanBeChanged(
  database: Database,
  row: StoredUserRow,
  nextRole: AuthRole,
  nextStatus: UserStatus,
  actorUsername: string,
) {
  if (row.username.toLowerCase() === actorUsername.toLowerCase()
    && (nextRole !== "admin" || nextStatus === "disabled")) {
    throw new AccountProtectionError("目前登入的管理員不能停用或降級自己的帳號。");
  }
  const removesAvailableAdmin = row.role === "admin"
    && row.status !== "disabled"
    && (nextRole !== "admin" || nextStatus === "disabled");
  if (!removesAvailableAdmin) return;
  const remaining = await database.prepare(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status != 'disabled'",
  ).first<{ count: number }>();
  if ((remaining?.count ?? 0) <= 1) {
    throw new AccountProtectionError("系統至少必須保留一個可使用的 admin 帳號。");
  }
}

export async function ensureUsersTable(database: Database) {
  if (!usersTableReady) {
    usersTableReady = (async () => {
      await database.prepare(USERS_TABLE_SQL).run();
      await database.prepare(USERS_USERNAME_INDEX_SQL).run();
      await database.prepare(SIGN_IN_EVENTS_TABLE_SQL).run();
      await database.prepare(SIGN_IN_EVENTS_USERNAME_INDEX_SQL).run();
      await database.prepare(SIGN_IN_EVENTS_CREATED_AT_INDEX_SQL).run();
      await database.batch(initialAccounts.map((account) => database.prepare(
        `INSERT OR IGNORE INTO users (
          id, name, username, role, status, password_hash, password_salt,
          password_iterations, force_password_change, created_by
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 0, 'system')`,
      ).bind(
        account.id,
        account.username,
        account.username,
        account.role,
        account.password.hash,
        account.password.salt,
        account.password.iterations,
      )));
      await database.prepare(
        "UPDATE users SET name = username, force_password_change = 0 WHERE name != username OR force_password_change != 0",
      ).run();
      await database.prepare(
        "UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE status = 'pending'",
      ).run();
      await database.prepare("PRAGMA optimize").run();
    })().catch((error) => {
      usersTableReady = null;
      throw error;
    });
  }
  return usersTableReady;
}

async function insertSignInEvent(
  database: Database,
  options: {
    userId?: string | null;
    username: string;
    outcome: SignInOutcome;
    context: SignInContext;
  },
) {
  await database.prepare(
    `INSERT INTO sign_in_events (id, user_id, username, success, outcome, source, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `AUTH-${crypto.randomUUID().toUpperCase()}`,
    options.userId ?? null,
    options.username.trim().toLowerCase().slice(0, 80) || "unknown",
    options.outcome === "success" ? 1 : 0,
    options.outcome,
    options.context.source.slice(0, 120) || "未知來源",
    options.context.userAgent?.slice(0, 500) || null,
  ).run();
}

export async function recordSignInEvent(database: Database, options: {
  username: string;
  outcome: SignInOutcome;
  context: SignInContext;
}) {
  await ensureUsersTable(database);
  const normalizedUsername = options.username.trim().toLowerCase().slice(0, 80) || "unknown";
  const user = await database.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1")
    .bind(normalizedUsername)
    .first<{ id: string }>();
  await insertSignInEvent(database, {
    userId: user?.id,
    username: normalizedUsername,
    outcome: options.outcome,
    context: options.context,
  });
}

async function unlockExpiredAccounts(database: Database) {
  await database.prepare(
    `UPDATE users
    SET status = 'active', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'locked'
      AND NOT EXISTS (
        SELECT 1 FROM sign_in_events
        WHERE sign_in_events.username = users.username COLLATE NOCASE
          AND sign_in_events.outcome = 'invalid_credentials'
          AND sign_in_events.created_at >= datetime('now', '-15 minutes')
      )`,
  ).run();
}

export async function listUsers(database: Database) {
  await ensureUsersTable(database);
  await unlockExpiredAccounts(database);
  const result = await database.prepare(
    `SELECT id, name, username, role, status, password_hash, password_salt,
      password_iterations, force_password_change, last_login_at, created_by, created_at, updated_at
    FROM users
    ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'supervisor' THEN 2 ELSE 3 END, created_at ASC`,
  ).all<StoredUserRow>();
  return result.results.map(publicUser);
}

export async function getStoredUserAccess(database: Database, username: string) {
  await ensureUsersTable(database);
  const row = await database.prepare(
    `SELECT id, name, username, role, status, password_hash, password_salt,
      password_iterations, force_password_change, last_login_at, created_by, created_at, updated_at
    FROM users WHERE username = ? COLLATE NOCASE LIMIT 1`,
  ).bind(username.trim().toLowerCase()).first<StoredUserRow>();
  return row ? publicUser(row) : null;
}

export async function authenticateStoredUser(
  database: Database,
  username: string,
  password: string,
  context: SignInContext = { source: "未知來源" },
) {
  await ensureUsersTable(database);
  const normalizedUsername = username.trim().toLowerCase();
  const row = await database.prepare(
    `SELECT id, name, username, role, status, password_hash, password_salt,
      password_iterations, force_password_change, last_login_at, created_by, created_at, updated_at
    FROM users WHERE username = ? COLLATE NOCASE LIMIT 1`,
  ).bind(normalizedUsername).first<StoredUserRow>();
  if (!row) {
    await insertSignInEvent(database, { username: normalizedUsername, outcome: "account_not_found", context });
    return null;
  }
  if (row.status === "disabled") {
    await insertSignInEvent(database, { userId: row.id, username: row.username, outcome: "account_disabled", context });
    return null;
  }
  if (row.status === "locked") {
    const activeLock = await database.prepare(
      `SELECT COUNT(*) AS count FROM sign_in_events
      WHERE username = ? COLLATE NOCASE
        AND outcome = 'invalid_credentials'
        AND created_at >= datetime('now', '-15 minutes')`,
    ).bind(row.username).first<{ count: number }>();
    if ((activeLock?.count ?? 0) > 0) {
      await insertSignInEvent(database, { userId: row.id, username: row.username, outcome: "account_locked", context });
      return null;
    }
    await database.prepare(
      "UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(row.id).run();
  }
  const passwordMatches = await verifyPassword(password, {
    hash: row.password_hash,
    salt: row.password_salt,
    iterations: row.password_iterations,
  });
  if (!passwordMatches) {
    await insertSignInEvent(database, { userId: row.id, username: row.username, outcome: "invalid_credentials", context });
    const recentAttempts = await database.prepare(
      `SELECT success, outcome FROM sign_in_events
      WHERE username = ? COLLATE NOCASE
        AND created_at >= datetime('now', '-15 minutes')
      ORDER BY created_at DESC, rowid DESC
      LIMIT 5`,
    ).bind(row.username).all<{ success: number; outcome: SignInOutcome }>();
    const shouldLock = recentAttempts.results.length === 5
      && recentAttempts.results.every((attempt) => attempt.success === 0 && attempt.outcome === "invalid_credentials");
    if (shouldLock) {
      await database.prepare(
        "UPDATE users SET status = 'locked', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).bind(row.id).run();
    }
    return null;
  }

  await database.prepare(
    "UPDATE users SET status = 'active', last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(row.id).run();
  await insertSignInEvent(database, { userId: row.id, username: row.username, outcome: "success", context });
  return { username: row.username, name: row.username, role: row.role };
}

export async function getSignInSecuritySnapshot(database: Database) {
  await ensureUsersTable(database);
  await unlockExpiredAccounts(database);
  const [eventsResult, failedResult, lockedResult] = await Promise.all([
    database.prepare(
      `SELECT id, username, success, outcome, source, created_at
      FROM sign_in_events
      WHERE created_at >= datetime('now', '-24 hours')
      ORDER BY created_at DESC, rowid DESC
      LIMIT 100`,
    ).all<{ id: string; username: string; success: number; outcome: SignInOutcome; source: string; created_at: string }>(),
    database.prepare(
      "SELECT COUNT(*) AS count FROM sign_in_events WHERE success = 0 AND created_at >= datetime('now', '-24 hours')",
    ).first<{ count: number }>(),
    database.prepare("SELECT COUNT(*) AS count FROM users WHERE status = 'locked'").first<{ count: number }>(),
  ]);
  const events: SignInEvent[] = eventsResult.results.map((event) => ({
    id: event.id,
    username: event.username,
    success: event.success === 1,
    outcome: event.outcome,
    source: event.source,
    createdAt: event.created_at,
  }));
  return {
    events,
    failedCount24h: failedResult?.count ?? 0,
    lockedCount: lockedResult?.count ?? 0,
  };
}

export async function createStoredUser(database: Database, options: {
  username: string;
  role: AuthRole;
  password: string;
  createdBy: string;
}) {
  await ensureUsersTable(database);
  const normalizedUsername = options.username.trim().toLowerCase();
  const existing = await database.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1")
    .bind(normalizedUsername)
    .first<{ id: string }>();
  if (existing) throw new DuplicateUsernameError();

  const credential = await createPasswordCredential(options.password);
  const id = `USR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  try {
    await database.prepare(
      `INSERT INTO users (
        id, name, username, role, status, password_hash, password_salt,
        password_iterations, force_password_change, created_by
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      normalizedUsername,
      normalizedUsername,
      options.role,
      credential.hash,
      credential.salt,
      credential.iterations,
      0,
      options.createdBy,
    ).run();
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed|users_username_uidx/i.test(error.message)) {
      throw new DuplicateUsernameError();
    }
    throw error;
  }

  const row = await database.prepare(
    `SELECT id, name, username, role, status, password_hash, password_salt,
      password_iterations, force_password_change, last_login_at, created_by, created_at, updated_at
    FROM users WHERE id = ? LIMIT 1`,
  ).bind(id).first<StoredUserRow>();
  if (!row) throw new Error("帳號已建立，但無法讀取建立結果。");
  return publicUser(row);
}

export async function resetStoredUserPassword(database: Database, options: {
  userId: string;
  password: string;
}) {
  await ensureUsersTable(database);
  await findUserById(database, options.userId);
  const credential = await createPasswordCredential(options.password);
  await database.prepare(
    `UPDATE users
    SET password_hash = ?, password_salt = ?, password_iterations = ?,
      force_password_change = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
  ).bind(credential.hash, credential.salt, credential.iterations, options.userId).run();
  return publicUser(await findUserById(database, options.userId));
}

export async function updateStoredUserStatus(database: Database, options: {
  userId: string;
  status: "active" | "disabled";
  actorUsername: string;
}) {
  await ensureUsersTable(database);
  const row = await findUserById(database, options.userId);
  await assertAdminCanBeChanged(database, row, row.role, options.status, options.actorUsername);
  await database.prepare(
    "UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(options.status, options.userId).run();
  return publicUser(await findUserById(database, options.userId));
}

export async function updateStoredUserRole(database: Database, options: {
  userId: string;
  role: AuthRole;
  actorUsername: string;
}) {
  await ensureUsersTable(database);
  const row = await findUserById(database, options.userId);
  await assertAdminCanBeChanged(database, row, options.role, row.status, options.actorUsername);
  await database.prepare(
    "UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(options.role, options.userId).run();
  return publicUser(await findUserById(database, options.userId));
}
