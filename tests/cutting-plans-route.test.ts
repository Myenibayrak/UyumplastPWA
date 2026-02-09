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

describe("Cutting Plans validation", () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    requireRoleMock.mockReset();
    fromMock.mockReset();
  });

  it("POST rejects invalid payload", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "production" });
    requireRoleMock.mockReturnValue(null);

    const { POST } = await import("@/app/api/cutting-plans/route");
    const req = new Request("http://localhost/api/cutting-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: "invalid-uuid" }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it("PATCH rejects empty payload", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "production" });
    requireRoleMock.mockReturnValue(null);

    const { PATCH } = await import("@/app/api/cutting-plans/[id]/route");
    const req = new Request("http://localhost/api/cutting-plans/plan-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await PATCH(req as any, { params: { id: "plan-1" } });
    expect(res.status).toBe(400);
  });

  it("POST creates plan using source fields from selected stock", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "production", fullName: "Esat" });
    requireRoleMock.mockReturnValue(null);

    const ordersSelectSingleMock = vi.fn().mockResolvedValue({
      data: { id: "11111111-1111-1111-1111-111111111111", status: "confirmed" },
      error: null,
    });
    const ordersSelectEqMock = vi.fn(() => ({ single: ordersSelectSingleMock }));
    const ordersSelectMock = vi.fn(() => ({ eq: ordersSelectEqMock }));

    const ordersUpdateInMock = vi.fn().mockResolvedValue({ error: null });
    const ordersUpdateEqMock = vi.fn(() => ({ in: ordersUpdateInMock }));
    const ordersUpdateMock = vi.fn(() => ({ eq: ordersUpdateEqMock }));

    const stockSelectSingleMock = vi.fn().mockResolvedValue({
      data: { id: "22222222-2222-2222-2222-222222222222", category: "film", product: "PE", micron: 35, width: 150, kg: 1200 },
      error: null,
    });
    const stockSelectEqMock = vi.fn(() => ({ single: stockSelectSingleMock }));
    const stockSelectMock = vi.fn(() => ({ eq: stockSelectEqMock }));

    const insertedPlan = { id: "33333333-3333-3333-3333-333333333333" };
    const cuttingPlansInsertSingleMock = vi.fn().mockResolvedValue({ data: insertedPlan, error: null });
    const cuttingPlansInsertSelectMock = vi.fn(() => ({ single: cuttingPlansInsertSingleMock }));
    const cuttingPlansInsertMock = vi.fn(() => ({ select: cuttingPlansInsertSelectMock }));

    const auditInsertMock = vi.fn().mockResolvedValue({ error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === "orders") return { select: ordersSelectMock, update: ordersUpdateMock };
      if (table === "stock_items") return { select: stockSelectMock };
      if (table === "cutting_plans") return { insert: cuttingPlansInsertMock };
      if (table === "audit_logs") return { insert: auditInsertMock };
      throw new Error(`Unexpected table ${table}`);
    });

    const { POST } = await import("@/app/api/cutting-plans/route");
    const req = new Request("http://localhost/api/cutting-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: "11111111-1111-1111-1111-111111111111",
        source_stock_id: "22222222-2222-2222-2222-222222222222",
        source_product: "IGNORED",
      }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(201);
    expect(cuttingPlansInsertMock).toHaveBeenCalledWith(expect.objectContaining({
      source_product: "PE",
      source_micron: 35,
      source_width: 150,
      source_kg: 1200,
    }));
    expect(ordersUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("POST rejects plan creation for shipped order", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "production", fullName: "Esat" });
    requireRoleMock.mockReturnValue(null);

    const ordersSelectSingleMock = vi.fn().mockResolvedValue({
      data: { id: "11111111-1111-1111-1111-111111111111", status: "shipped" },
      error: null,
    });
    const ordersSelectEqMock = vi.fn(() => ({ single: ordersSelectSingleMock }));
    const ordersSelectMock = vi.fn(() => ({ eq: ordersSelectEqMock }));
    const cuttingPlansInsertMock = vi.fn();

    fromMock.mockImplementation((table: string) => {
      if (table === "orders") return { select: ordersSelectMock };
      if (table === "cutting_plans") return { insert: cuttingPlansInsertMock };
      throw new Error(`Unexpected table ${table}`);
    });

    const { POST } = await import("@/app/api/cutting-plans/route");
    const req = new Request("http://localhost/api/cutting-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: "11111111-1111-1111-1111-111111111111",
        source_stock_id: "22222222-2222-2222-2222-222222222222",
        source_product: "PE",
      }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    expect(cuttingPlansInsertMock).not.toHaveBeenCalled();
  });
});
