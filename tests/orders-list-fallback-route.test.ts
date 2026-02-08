import { describe, it, expect, vi, beforeEach } from "vitest";

const adminOrderMock = vi.fn();
const adminFromMock = vi.fn(() => ({ select: adminOrderMock }));

const serverOrderMock = vi.fn();
const serverFromMock = vi.fn(() => ({ select: serverOrderMock }));

vi.mock("@/lib/auth/guards", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1", role: "admin" })),
  requireRole: vi.fn(() => null),
  isAuthError: vi.fn(() => false),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: adminFromMock,
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(() => ({
    from: serverFromMock,
  })),
}));

describe("Orders GET Fallback", () => {
  beforeEach(() => {
    adminOrderMock.mockReset();
    serverOrderMock.mockReset();
  });

  it("falls back to server client when admin client returns empty list", async () => {
    adminOrderMock.mockReturnValueOnce({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    serverOrderMock.mockReturnValueOnce({
      order: vi.fn().mockResolvedValue({
        data: [
          {
            id: "order-1",
            order_no: "A-1",
            customer: "ACME",
            order_tasks: [],
          },
        ],
        error: null,
      }),
    });

    const { GET } = await import("@/app/api/orders/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].order_no).toBe("A-1");
  });
});
