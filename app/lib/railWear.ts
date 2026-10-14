export type RailWearMode = "tread" | "side";
export type RailDirection = "up" | "down";
export type RailSide = "left" | "right";
export type RailWearRecordType = "measurement" | "replacement";

export type RailWearRecordFields = {
  mode: RailWearMode;
  direction: RailDirection;
  pointNumber: number;
  side: RailSide;
  measuredAt: string;
  wear: number;
  inspector: string;
  method: string;
  recordType: RailWearRecordType;
  note: string | null;
};

export type RailWearRecord = RailWearRecordFields & {
  id: string;
  revisionNo: number;
  correctionReason: string | null;
  correctedBy: string | null;
  createdBy: string;
  createdIp: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  deletion: {
    deletedAt: string;
    deletedBy: string;
    deletedIp: string;
    deleteReason: string;
  } | null;
  lifecycleEvents: Array<{
    id: string;
    action: "deleted" | "restored";
    reason: string;
    actor: string;
    sourceIp: string;
    createdAt: string;
  }>;
};

export type RailWearPayload = {
  records: RailWearRecord[];
  deletedRecords: RailWearRecord[];
};
