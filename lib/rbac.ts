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

export function normalizeUserName(value: string): string {
  return normalizeTurkish(value || "");
}

type RoleOverrideRule = {
  role: AppRole;
  tokens: string[];
};

const ROLE_OVERRIDE_RULES: RoleOverrideRule[] = [
  { role: "admin", tokens: ["muhammed"] },
  { role: "admin", tokens: ["mustafa"] },
  { role: "sales", tokens: ["harun", "musa"] },
  { role: "shipping", tokens: ["turgut"] },
  { role: "warehouse", tokens: ["ugur", "turgay"] },
  { role: "production", tokens: ["esat"] },
  { role: "production", tokens: ["gokhan"] },
  { role: "production", tokens: ["mehmet", "ali"] },
];

export function resolveRoleByIdentity(role: AppRole | null | undefined, fullName?: string | null): AppRole | null {
  const normalized = normalizeTurkish(fullName || "");
  if (!normalized) return role ?? null;

  const parts = normalized.split(/\s+/).filter(Boolean);
  for (const rule of ROLE_OVERRIDE_RULES) {
    const matched = rule.tokens.every((token) => parts.includes(token));
    if (matched) return rule.role;
  }

  return role ?? null;
}

export function isFactoryManager(fullName?: string | null): boolean {
  const normalized = normalizeTurkish(fullName || "");
  if (!normalized) return false;
  if (normalized.includes("fabrika muduru")) return true;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  // Explicit business rule from user: "Fabrika müdür Esat"
  return tokens.includes("esat");
}

export function canViewStock(role: AppRole | null | undefined, fullName?: string | null): boolean {
  if (!role) return false;
  if (role === "admin" || role === "sales") return true;

  const normalized = normalizeTurkish(fullName || "");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const hasNamedAccess = tokens.some((t) => t === "muhammed" || t === "mustafa");
  const factoryManager = isFactoryManager(fullName);

  return hasNamedAccess || factoryManager;
}

export function canCloseOrders(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "accounting";
}

export function canCreateStock(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "accounting";
}

export function canEditStock(role: AppRole | null | undefined): boolean {
  return role === "admin";
}

export function canUseWarehouseEntry(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "warehouse";
}

export function canUseBobinEntry(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "production";
}

export function canManageProductionPlans(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "production";
}

export function canViewOrderHistory(role: AppRole | null | undefined, fullName?: string | null): boolean {
  if (!role) return false;
  if (role === "admin" || role === "accounting") return true;
  if (isFactoryManager(fullName)) return true;

  const normalized = normalizeTurkish(fullName || "");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.some((token) => ["mustafa", "muhammed", "admin", "imren"].includes(token));
}

export function canViewAuditTrail(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "sales" || role === "accounting";
}

export function canManageShippingSchedule(role: AppRole | null | undefined, fullName?: string | null): boolean {
  if (role === "admin" || role === "sales") return true;
  return isFactoryManager(fullName);
}

export function canViewShippingSchedule(role: AppRole | null | undefined, fullName?: string | null): boolean {
  if (canManageShippingSchedule(role, fullName)) return true;
  return role === "shipping";
}

export function canCompleteShipping(role: AppRole | null | undefined, fullName?: string | null): boolean {
  if (role === "shipping" || role === "admin") return true;
  return isFactoryManager(fullName);
}

export function canSendOrderNudge(role: AppRole | null | undefined, fullName?: string | null): boolean {
  if (role === "admin" || role === "sales") return true;
  return isFactoryManager(fullName);
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
