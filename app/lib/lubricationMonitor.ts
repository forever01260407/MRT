import type { LubricationRecord } from "./lubricationExcel";

export type LubricationRevision = LubricationRecord & {
  id: string;
  revisionNo: number;
  correctionReason: string;
  correctedBy: string;
  createdBy: string;
  createdAt: string;
};

export type MonitoredLubricationRecord = {
  id: string;
  original: LubricationRecord;
  current: LubricationRecord;
  status: "有效" | "已更正";
  sourceType: "Excel 匯入" | "現場登記";
  sourceName: string;
  createdBy: string;
  createdAt: string;
  revisions: LubricationRevision[];
};

export type MonitorPayload = {
  records: MonitoredLubricationRecord[];
  count: number;
  revisionCount: number;
};

