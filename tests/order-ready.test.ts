import { describe, expect, it } from "vitest";
import { calculateReadyMetrics, deriveOrderStatusFromReady } from "@/lib/order-ready";

describe("order-ready helpers", () => {
  it("calculates total ready and threshold", () => {
    const metrics = calculateReadyMetrics(100, 30, 66);
    expect(metrics.totalReadyKg).toBe(96);
    expect(metrics.isReady).toBe(true);
  });

  it("promotes active order to ready at threshold", () => {
    const next = deriveOrderStatusFromReady("confirmed", "stock", true);
    expect(next).toBe("ready");
  });

  it("falls back from ready to in_production when production order drops below threshold", () => {
    const next = deriveOrderStatusFromReady("ready", "production", false);
    expect(next).toBe("in_production");
  });

  it("falls back from ready to confirmed when stock order drops below threshold", () => {
    const next = deriveOrderStatusFromReady("ready", "stock", false);
    expect(next).toBe("confirmed");
  });

  it("never mutates closed/cancelled/shipped/delivered statuses", () => {
    expect(deriveOrderStatusFromReady("closed", "both", true)).toBe("closed");
    expect(deriveOrderStatusFromReady("cancelled", "both", true)).toBe("cancelled");
    expect(deriveOrderStatusFromReady("shipped", "both", false)).toBe("shipped");
    expect(deriveOrderStatusFromReady("delivered", "both", false)).toBe("delivered");
  });
});
