import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthMock = vi.fn();
const requireRoleMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/auth/guards", () => ({
  requireAuth: requireAuthMock,
  requireRole: requireRoleMock,
  isAuthError: vi.fn(() => false),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: fromMock,
  })),
}));

describe("Cutting Entries POST", () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    requireRoleMock.mockReset();
    fromMock.mockReset();
  });

  it("rejects when requested kg is greater than source stock kg", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "production" });
    requireRoleMock.mockReturnValue(null);

    const cuttingPlanSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: "plan-1",
        order_id: "order-1",
        source_stock_id: "stock-1",
        source_product: "PE",
        source_micron: 35,
      },
      error: null,
    });
    const stockSingleMock = vi.fn().mockResolvedValue({
      data: { kg: 9, quantity: 1 },
      error: null,
    });

    fromMock.mockImplementation((table: string) => {
      if (table === "cutting_plans") {
        return {
          select: () => ({ eq: () => ({ single: cuttingPlanSingleMock }) }),
        };
      }
      if (table === "stock_items") {
        return {
          select: () => ({ eq: () => ({ single: stockSingleMock }) }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const { POST } = await import("@/app/api/cutting-entries/route");
    const req = new Request("http://localhost/api/cutting-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cutting_plan_id: "plan-1",
        bobbin_label: "KESIM-1",
        cut_width: 1000,
        cut_kg: 10,
      }),
    });

    const res = await POST(req as any);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Yetersiz stok");
  });
});
