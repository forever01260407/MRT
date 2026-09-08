import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const importBatches = sqliteTable("import_batches", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  submittedCount: integer("submitted_count").notNull(),
  insertedCount: integer("inserted_count").notNull(),
  duplicateCount: integer("duplicate_count").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const measurements = sqliteTable("measurements", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  measuredAt: text("measured_at").notNull(),
  oilLevel: real("oil_level").notNull(),
  inspector: text("inspector").notNull(),
  recordType: text("record_type").notNull(),
  refillAmount: real("refill_amount"),
  importBatchId: text("import_batch_id").notNull().references(() => importBatches.id),
  createdBy: text("created_by").notNull(),
  createdIp: text("created_ip").notNull().default("未知"),
  deletedAt: text("deleted_at"),
  deletedBy: text("deleted_by"),
  deletedIp: text("deleted_ip"),
  deleteReason: text("delete_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("measurements_device_measured_at_uidx").on(table.deviceId, table.measuredAt),
  index("idx_measurements_measured_at").on(table.measuredAt),
  index("idx_measurements_import_batch_id").on(table.importBatchId),
  index("idx_measurements_deleted_at").on(table.deletedAt),
  check("measurements_oil_level_nonnegative", sql`${table.oilLevel} >= 0`),
  check("measurements_record_type_valid", sql`${table.recordType} IN ('量測', '補油')`),
]);

export const measurementRevisions = sqliteTable("measurement_revisions", {
  id: text("id").primaryKey(),
  measurementId: text("measurement_id").notNull().references(() => measurements.id),
  revisionNo: integer("revision_no").notNull(),
  deviceId: text("device_id").notNull(),
  measuredAt: text("measured_at").notNull(),
  oilLevel: real("oil_level").notNull(),
  inspector: text("inspector").notNull(),
  recordType: text("record_type").notNull(),
  refillAmount: real("refill_amount"),
  correctionReason: text("correction_reason").notNull(),
  correctedBy: text("corrected_by").notNull(),
  createdBy: text("created_by").notNull(),
  sourceIp: text("source_ip").notNull().default("未知"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("measurement_revisions_measurement_revision_uidx").on(table.measurementId, table.revisionNo),
  index("idx_measurement_revisions_measurement_id").on(table.measurementId),
  index("idx_measurement_revisions_created_at").on(table.createdAt),
  check("measurement_revisions_oil_level_nonnegative", sql`${table.oilLevel} >= 0`),
  check("measurement_revisions_record_type_valid", sql`${table.recordType} IN ('量測', '補油')`),
]);

export const measurementLifecycleEvents = sqliteTable("measurement_lifecycle_events", {
  id: text("id").primaryKey(),
  measurementId: text("measurement_id").notNull().references(() => measurements.id),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  sourceIp: text("source_ip").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_measurement_lifecycle_events_measurement_created_at").on(table.measurementId, table.createdAt),
  index("idx_measurement_lifecycle_events_created_at").on(table.createdAt),
  check("measurement_lifecycle_events_action_valid", sql`${table.action} IN ('deleted', 'restored')`),
]);

export const deviceAxleProfiles = sqliteTable("device_axle_profiles", {
  deviceId: text("device_id").primaryKey(),
  effectiveDate: text("effective_date").notNull(),
  stageCount: integer("stage_count").notNull(),
  axleCount: integer("axle_count").notNull(),
  updatedBy: text("updated_by").notNull().default("system"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  check("device_axle_profiles_stage_count_positive", sql`${table.stageCount} > 0`),
  check("device_axle_profiles_axle_count_positive", sql`${table.axleCount} > 0`),
]);

export const deviceAxleProfileEvents = sqliteTable("device_axle_profile_events", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  previousStageCount: integer("previous_stage_count"),
  stageCount: integer("stage_count").notNull(),
  previousAxleCount: integer("previous_axle_count"),
  axleCount: integer("axle_count").notNull(),
  previousEffectiveDate: text("previous_effective_date"),
  effectiveDate: text("effective_date").notNull(),
  changedBy: text("changed_by").notNull(),
  sourceIp: text("source_ip").notNull().default("未知"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_device_axle_profile_events_device_created_at").on(table.deviceId, table.createdAt),
  index("idx_device_axle_profile_events_created_at").on(table.createdAt),
  check("device_axle_profile_events_stage_count_positive", sql`${table.stageCount} > 0`),
  check("device_axle_profile_events_axle_count_positive", sql`${table.axleCount} > 0`),
  check("device_axle_profile_events_previous_stage_count_positive", sql`${table.previousStageCount} IS NULL OR ${table.previousStageCount} > 0`),
  check("device_axle_profile_events_previous_axle_count_positive", sql`${table.previousAxleCount} IS NULL OR ${table.previousAxleCount} > 0`),
]);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  forcePasswordChange: integer("force_password_change", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: text("last_login_at"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("users_username_uidx").on(table.username),
  check("users_role_valid", sql`${table.role} IN ('user', 'supervisor', 'admin')`),
  check("users_status_valid", sql`${table.status} IN ('active', 'pending', 'locked', 'disabled')`),
  check("users_password_iterations_positive", sql`${table.passwordIterations} > 0`),
]);

export const signInEvents = sqliteTable("sign_in_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  username: text("username").notNull(),
  success: integer("success", { mode: "boolean" }).notNull(),
  outcome: text("outcome").notNull(),
  source: text("source").notNull(),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_sign_in_events_username_created_at").on(table.username, table.createdAt),
  index("idx_sign_in_events_created_at").on(table.createdAt),
  check("sign_in_events_success_valid", sql`${table.success} IN (0, 1)`),
  check("sign_in_events_outcome_valid", sql`${table.outcome} IN ('success', 'invalid_credentials', 'account_not_found', 'account_disabled', 'account_locked', 'rate_limited')`),
]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  actorUserId: text("actor_user_id").references(() => users.id),
  actorUsername: text("actor_username").notNull(),
  actorRole: text("actor_role").notNull(),
  sourceIp: text("source_ip").notNull(),
  userAgent: text("user_agent"),
  requestId: text("request_id").notNull(),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  resourceLabel: text("resource_label"),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  reason: text("reason"),
  result: text("result").notNull(),
  errorCode: text("error_code"),
  metadataJson: text("metadata_json"),
  originType: text("origin_type"),
  originId: text("origin_id"),
}, (table) => [
  index("idx_audit_events_occurred_at").on(table.occurredAt),
  index("idx_audit_events_actor_occurred_at").on(table.actorUsername, table.occurredAt),
  index("idx_audit_events_action_occurred_at").on(table.action, table.occurredAt),
  index("idx_audit_events_resource").on(table.resourceType, table.resourceId),
  uniqueIndex("audit_events_origin_uidx").on(table.originType, table.originId),
  check("audit_events_result_valid", sql`${table.result} IN ('success', 'failure')`),
]);
