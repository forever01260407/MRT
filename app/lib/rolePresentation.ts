export type RoleCode = "user" | "userpro" | "supervisor" | "admin";

export const ROLE_DISPLAY_LABELS: Record<RoleCode, string> = {
  user: "USER",
  userpro: "AD USER",
  supervisor: "POWER USER",
  admin: "ADMIN",
};

export const ROLE_DISPLAY_MARKS: Record<RoleCode, string> = {
  user: "U",
  userpro: "AD",
  supervisor: "P",
  admin: "A",
};

export function getRoleDisplayLabel(role: RoleCode) {
  return ROLE_DISPLAY_LABELS[role];
}

export function getRoleDisplayMark(role: RoleCode) {
  return ROLE_DISPLAY_MARKS[role];
}
