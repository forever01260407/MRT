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
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("measurements_device_measured_at_uidx").on(table.deviceId, table.measuredAt),
  index("idx_measurements_measured_at").on(table.measuredAt),
  index("idx_measurements_import_batch_id").on(table.importBatchId),
  check("measurements_oil_level_nonnegative", sql`${table.oilLevel} >= 0`),
  check("measurements_record_type_valid", sql`${table.recordType} IN ('量測', '補油')`),
]);
