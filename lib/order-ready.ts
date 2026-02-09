import type { OrderStatus, SourceType } from "@/lib/types";

export const ORDER_READY_THRESHOLD_PERCENT = 95;

export function calculateReadyMetrics(
  quantity: number | null | undefined,
  stockReadyKg: number | null | undefined,
  productionReadyKg: number | null | undefined
) {
  const qty = Number(quantity || 0);
  const stock = Number(stockReadyKg || 0);
  const production = Number(productionReadyKg || 0);
  const totalReadyKg = stock + production;
  const readyPercent = qty > 0 ? (totalReadyKg / qty) * 100 : 0;
  const isReady = qty > 0 && readyPercent >= ORDER_READY_THRESHOLD_PERCENT;
  return { qty, stock, production, totalReadyKg, readyPercent, isReady };
}

function fallbackStatusForNotReady(sourceType: SourceType | null | undefined): OrderStatus {
  return sourceType === "production" || sourceType === "both" ? "in_production" : "confirmed";
}

export function deriveOrderStatusFromReady(
  currentStatus: OrderStatus | null | undefined,
  sourceType: SourceType | null | undefined,
  isReady: boolean
): OrderStatus | undefined {
  if (!currentStatus) return undefined;
  if (["cancelled", "closed", "shipped", "delivered"].includes(currentStatus)) return currentStatus;

  if (isReady) return "ready";
  if (currentStatus === "ready") return fallbackStatusForNotReady(sourceType);
  return currentStatus;
}
