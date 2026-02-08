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

function normalizeTurkish(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

export function canViewStock(role: AppRole | null | undefined, fullName?: string | null): boolean {
  if (!role) return false;
  if (role === "sales") return true;

  const normalized = normalizeTurkish(fullName || "");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const hasNamedAccess = tokens.some((t) => t === "muhammed" || t === "mustafa");
  const isFactoryManager = normalized.includes("fabrika muduru");

  return hasNamedAccess || isFactoryManager;
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
