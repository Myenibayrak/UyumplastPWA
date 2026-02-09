import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCTION_READY_STATUSES } from "@/lib/production-ready";

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

describe("Production Bobins PATCH", () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    requireRoleMock.mockReset();
    requireRoleMock.mockReturnValue(null);
    fromMock.mockReset();
  });

  it("rejects invalid status values", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "admin" });

    const { PATCH } = await import("@/app/api/production-bobins/[id]/route");
    const req = new Request("http://localhost/api/production-bobins/bobin-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "invalid_status" }),
    });

    const res = await PATCH(req as any, { params: { id: "bobin-1" } });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Geçersiz");
  });

  it("blocks production role from setting warehouse status", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "production" });

    const beforeSingleMock = vi.fn().mockResolvedValue({
      data: { id: "bobin-1", order_id: "order-1", status: "produced" },
      error: null,
    });
    const beforeEqMock = vi.fn(() => ({ single: beforeSingleMock }));
    fromMock.mockImplementation((table: string) => {
      if (table === "production_bobins") {
        return { select: () => ({ eq: beforeEqMock }) };
      }
      return {};
    });

    const { PATCH } = await import("@/app/api/production-bobins/[id]/route");
    const req = new Request("http://localhost/api/production-bobins/bobin-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "warehouse" }),
    });

    const res = await PATCH(req as any, { params: { id: "bobin-1" } });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Üretim");
  });

  it("recalculates using produced+warehouse+ready statuses", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "warehouse" });

    let productionBobinSelectCall = 0;
    const beforeSingleMock = vi.fn().mockResolvedValue({
      data: { id: "bobin-1", order_id: "order-1", status: "produced" },
      error: null,
    });
    const beforeEqMock = vi.fn(() => ({ single: beforeSingleMock }));

    const recalcInMock = vi.fn().mockResolvedValue({
      data: [{ kg: 10 }, { kg: 5 }],
      error: null,
    });
    const recalcEqMock = vi.fn(() => ({ in: recalcInMock }));

    const updateSingleMock = vi.fn().mockResolvedValue({
      data: { id: "bobin-1", order_id: "order-1", status: "warehouse" },
      error: null,
    });
    const updateEqMock = vi.fn(() => ({ select: vi.fn(() => ({ single: updateSingleMock })) }));
    const updateMock = vi.fn(() => ({ eq: updateEqMock }));

    const ordersSelectSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: "order-1",
        quantity: 40,
        status: "in_production",
        source_type: "production",
        stock_ready_kg: 5,
      },
      error: null,
    });
    const ordersSelectEqMock = vi.fn(() => ({ single: ordersSelectSingleMock }));
    const ordersSelectMock = vi.fn(() => ({ eq: ordersSelectEqMock }));

    const ordersUpdateEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const ordersUpdateMock = vi.fn(() => ({ eq: ordersUpdateEqMock }));
    const auditInsertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === "production_bobins") {
        return {
          select: () => {
            productionBobinSelectCall += 1;
            if (productionBobinSelectCall === 1) return { eq: beforeEqMock };
            return { eq: recalcEqMock };
          },
          update: updateMock,
        };
      }
      if (table === "orders") return { select: ordersSelectMock, update: ordersUpdateMock };
      if (table === "audit_logs") return { insert: auditInsertMock };
      throw new Error(`Unexpected table ${table}`);
    });

    const { PATCH } = await import("@/app/api/production-bobins/[id]/route");
    const req = new Request("http://localhost/api/production-bobins/bobin-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "warehouse" }),
    });

    const res = await PATCH(req as any, { params: { id: "bobin-1" } });

    expect(res.status).toBe(200);
    expect(recalcInMock).toHaveBeenCalledWith("status", [...PRODUCTION_READY_STATUSES]);
    expect(ordersUpdateMock).toHaveBeenCalled();
  });

  it("POST rejects bobin entry for stock-only orders", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "production" });
    requireRoleMock.mockReturnValue(null);

    const ordersSelectSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: "order-1",
        product_type: "PE",
        micron: 35,
        width: 150,
        status: "confirmed",
        source_type: "stock",
      },
      error: null,
    });
    const ordersSelectEqMock = vi.fn(() => ({ single: ordersSelectSingleMock }));
    const ordersSelectMock = vi.fn(() => ({ eq: ordersSelectEqMock }));
    const insertMock = vi.fn();

    fromMock.mockImplementation((table: string) => {
      if (table === "orders") return { select: ordersSelectMock };
      if (table === "production_bobins") return { insert: insertMock };
      throw new Error(`Unexpected table ${table}`);
    });

    const { POST } = await import("@/app/api/production-bobins/route");
    const req = new Request("http://localhost/api/production-bobins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: "order-1",
        bobbin_no: "BOB-1",
        meter: 1000,
        kg: 10,
      }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
