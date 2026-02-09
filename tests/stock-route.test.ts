import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthMock = vi.fn();
const fromMock = vi.fn();
const adminFromMock = vi.fn();

vi.mock("@/lib/auth/guards", () => ({
  requireAuth: requireAuthMock,
  isAuthError: vi.fn(() => false),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(() => ({
    from: fromMock,
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: adminFromMock,
  })),
}));

describe("Stock POST route", () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    fromMock.mockReset();
    adminFromMock.mockReset();
  });

  it("allows accounting role to create bulk stock rows", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "accounting", fullName: "İmren" });

    const stockSelectMock = vi.fn().mockResolvedValue({
      data: [
        { id: "s1", product: "PE", kg: 10, quantity: 1 },
        { id: "s2", product: "PP", kg: 5, quantity: 2 },
      ],
      error: null,
    });
    const stockInsertMock = vi.fn(() => ({ select: stockSelectMock }));
    const movementInsertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const auditInsertMock = vi.fn().mockResolvedValue({ data: null, error: null });

    adminFromMock.mockImplementation((table: string) => {
      if (table === "stock_items") return { insert: stockInsertMock };
      if (table === "stock_movements") return { insert: movementInsertMock };
      if (table === "audit_logs") return { insert: auditInsertMock };
      throw new Error(`Unexpected table ${table}`);
    });

    const { POST } = await import("@/app/api/stock/route");
    const req = new Request("http://localhost/api/stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { category: "film", product: "PE", kg: 10, quantity: 1 },
        { category: "film", product: "PP", kg: 5, quantity: 2 },
      ]),
    });

    const res = await POST(req as any);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(movementInsertMock).toHaveBeenCalledTimes(1);
    expect(auditInsertMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for invalid rows in bulk payload", async () => {
    requireAuthMock.mockResolvedValue({ userId: "user-1", role: "accounting", fullName: "İmren" });

    const { POST } = await import("@/app/api/stock/route");
    const req = new Request("http://localhost/api/stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ category: "film", product: "", kg: 1, quantity: 1 }]),
    });

    const res = await POST(req as any);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("geçersiz");
  });
});
