import { describe, expect, it } from "vitest";
import { PRODUCTION_READY_STATUSES, isProductionReadyStatus } from "@/lib/production-ready";

describe("Production Ready Statuses", () => {
  it("includes all statuses that must count into production_ready_kg", () => {
    expect(PRODUCTION_READY_STATUSES).toEqual(["produced", "warehouse", "ready"]);
  });

  it("checks status membership correctly", () => {
    expect(isProductionReadyStatus("produced")).toBe(true);
    expect(isProductionReadyStatus("warehouse")).toBe(true);
    expect(isProductionReadyStatus("ready")).toBe(true);
    expect(isProductionReadyStatus("cancelled")).toBe(false);
  });
});
