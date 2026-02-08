export const PRODUCTION_READY_STATUSES = ["produced", "warehouse", "ready"] as const;

export function isProductionReadyStatus(status: string): boolean {
  return PRODUCTION_READY_STATUSES.includes(status as typeof PRODUCTION_READY_STATUSES[number]);
}
