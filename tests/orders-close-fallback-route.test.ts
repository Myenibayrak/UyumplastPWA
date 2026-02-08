import { describe, it, expect, vi, beforeEach } from "vitest";

const singleMock = vi.fn();
const selectMock = vi.fn(() => ({ single: singleMock }));
const eqMock = vi.fn(() => ({ select: selectMock }));
const updateMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ update: updateMock }));

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
    singleMock.mockReset();
    fromMock.mockClear();
  });

  it("falls back to cancelled when closed enum is missing in DB", async () => {
    singleMock
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
    expect(singleMock).toHaveBeenCalledTimes(2);
  });
});
