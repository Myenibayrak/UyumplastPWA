import { type AppRole, WORKER_ROLES, FINANCE_ROLES } from "./types";

export function isWorkerRole(role: AppRole): boolean {
  return WORKER_ROLES.includes(role);
}

export function isFinanceRole(role: AppRole): boolean {
  return FINANCE_ROLES.includes(role);
}

export function canViewFinance(role: AppRole): boolean {
  return FINANCE_ROLES.includes(role);
}

export function canManageOrders(role: AppRole): boolean {
  return ["admin", "sales"].includes(role);
}

export function canAssignTasks(role: AppRole): boolean {
  return ["admin", "sales"].includes(role);
}

export function canViewAllOrders(role: AppRole): boolean {
  return ["admin", "sales", "accounting"].includes(role);
}

export function canEditSettings(role: AppRole): boolean {
  return role === "admin";
}

export function canViewDashboard(role: AppRole): boolean {
  return true;
}

export function getDefaultRedirect(role: AppRole): string {
  if (isWorkerRole(role)) return "/dashboard/tasks";
  return "/dashboard";
}

export function hasAnyRole(userRole: AppRole, allowedRoles: AppRole[]): boolean {
  return allowedRoles.includes(userRole);
}

export const FINANCE_FIELDS = [
  "price",
  "payment_term",
  "currency",
] as const;

export function stripFinanceFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result = { ...obj };
  for (const field of FINANCE_FIELDS) {
    delete result[field];
  }
  return result;
}
