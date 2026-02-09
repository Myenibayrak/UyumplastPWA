import { describe, it, expect, vi, beforeEach } from "vitest";

const beforeSingleMock = vi.fn();
const beforeEqMock = vi.fn(() => ({ single: beforeSingleMock }));
const beforeSelectMock = vi.fn(() => ({ eq: beforeEqMock }));

const updateSingleMock = vi.fn();
const updateSelectMock = vi.fn(() => ({ single: updateSingleMock }));
const updateEqMock = vi.fn(() => ({ select: updateSelectMock }));
const updateMock = vi.fn(() => ({ eq: updateEqMock }));

const auditInsertMock = vi.fn().mockResolvedValue({ data: null, error: null });
const fromMock = vi.fn((table: string) => {
  if (table === "orders") {
    return { select: beforeSelectMock, update: updateMock };
  }
  if (table === "audit_logs") {
    return { insert: auditInsertMock };
  }
  return {};
});

vi.mock("@/lib/auth/guards", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1", role: "accounting" })),
  requireRole: vi.fn(() => null),
  isAuthError: vi.fn(() => false),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: fromMock,
  })),
}));

describe("Orders PATCH Closed Fallback", () => {
  beforeEach(() => {
    beforeSingleMock.mockReset();
    updateSingleMock.mockReset();
    fromMock.mockClear();
    auditInsertMock.mockClear();
  });

  it("falls back to cancelled when closed enum is missing in DB", async () => {
    beforeSingleMock.mockResolvedValue({
      data: { id: "order-1", status: "draft" },
      error: null,
    });

    updateSingleMock
      .mockResolvedValueOnce({
        data: null,
        error: { message: "invalid input value for enum order_status: \"closed\"" },
      })
      .mockResolvedValueOnce({
        data: { id: "order-1", status: "cancelled", closed_by: "user-1", closed_at: "2026-02-08T00:00:00.000Z" },
        error: null,
      });

    const { PATCH } = await import("@/app/api/orders/[id]/route");
    const req = new Request("http://localhost/api/orders/order-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });

    const res = await PATCH(req as any, { params: { id: "order-1" } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("cancelled");
    expect(updateSingleMock).toHaveBeenCalledTimes(2);
  });
});
