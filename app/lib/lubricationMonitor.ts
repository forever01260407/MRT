import type { LubricationRecord } from "./lubricationExcel";

export type LubricationRevision = LubricationRecord & {
  id: string;
  revisionNo: number;
  correctionReason: string;
  correctedBy: string;
  createdBy: string;
  sourceIp: string;
  createdAt: string;
};

export type MeasurementLifecycleEvent = {
  id: string;
  action: "deleted" | "restored";
  reason: string;
  actor: string;
  sourceIp: string;
  createdAt: string;
};

export type MeasurementDeletion = {
  deletedAt: string;
  deletedBy: string;
  deletedIp: string;
  deleteReason: string;
};

export type MonitoredLubricationRecord = {
  id: string;
  original: LubricationRecord;
  current: LubricationRecord;
  status: "有效" | "已更正" | "已刪除";
  sourceType: "Excel 匯入" | "現場登記";
  sourceName: string;
  createdBy: string;
  createdIp: string;
  createdAt: string;
  revisions: LubricationRevision[];
  deletion: MeasurementDeletion | null;
  lifecycleEvents: MeasurementLifecycleEvent[];
};

export type MonitorPayload = {
  records: MonitoredLubricationRecord[];
  deletedRecords: MonitoredLubricationRecord[];
  count: number;
  deletedCount: number;
  revisionCount: number;
};
