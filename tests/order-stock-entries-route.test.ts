import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/auth/guards", () => ({
  requireAuth: requireAuthMock,
  isAuthError: vi.fn(() => false),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: fromMock,
  })),
}));

describe("Order Stock Entries POST", () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    fromMock.mockReset();
  });

  it("rejects non-positive kg", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "warehouse" });

    const { POST } = await import("@/app/api/order-stock-entries/route");
    const req = new Request("http://localhost/api/order-stock-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: "order-1", bobbin_label: "STK-1", kg: 0 }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it("recalculates stock_ready_kg after insert", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "warehouse" });

    let orderStockEntriesCall = 0;
    const inserted = {
      id: "entry-1",
      order_id: "order-1",
      bobbin_label: "STK-1",
      kg: 7.5,
    };

    const insertSingleMock = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const insertSelectMock = vi.fn(() => ({ single: insertSingleMock }));
    const insertMock = vi.fn(() => ({ select: insertSelectMock }));

    const listEqMock = vi.fn().mockResolvedValue({
      data: [{ kg: 7.5 }, { kg: 2.5 }],
      error: null,
    });
    const listSelectMock = vi.fn(() => ({ eq: listEqMock }));

    const ordersEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const ordersUpdateMock = vi.fn(() => ({ eq: ordersEqMock }));
    const auditInsertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === "order_stock_entries") {
        orderStockEntriesCall += 1;
        if (orderStockEntriesCall === 1) return { insert: insertMock };
        return { select: listSelectMock };
      }
      if (table === "orders") return { update: ordersUpdateMock };
      if (table === "audit_logs") return { insert: auditInsertMock };
      throw new Error(`Unexpected table ${table}`);
    });

    const { POST } = await import("@/app/api/order-stock-entries/route");
    const req = new Request("http://localhost/api/order-stock-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: "order-1", bobbin_label: "STK-1", kg: 7.5 }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(201);
    expect(ordersUpdateMock).toHaveBeenCalledWith({ stock_ready_kg: 10 });
    expect(ordersEqMock).toHaveBeenCalledWith("id", "order-1");
  });
});
