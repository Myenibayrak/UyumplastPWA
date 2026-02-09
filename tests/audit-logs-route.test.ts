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

function createQueryResult(data: unknown, error: { message: string } | null = null) {
  return {
    data,
    error,
    select() { return this; },
    order() { return this; },
    limit() { return this; },
    eq() { return this; },
  };
}

describe("Audit Logs GET route", () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    fromMock.mockReset();
  });

  it("forbids unauthorized roles", async () => {
    requireAuthMock.mockResolvedValue({ userId: "u1", role: "warehouse" });

    const { GET } = await import("@/app/api/audit-logs/route");
    const req = new Request("http://localhost/api/audit-logs");
    const res = await GET(req as any);

    expect(res.status).toBe(403);
  });

  it("returns logs for management roles", async () => {
    requireAuthMock.mockResolvedValue({ userId: "u1", role: "sales" });

    fromMock.mockImplementation((table: string) => {
      if (table !== "audit_logs") throw new Error(`Unexpected table ${table}`);
      return createQueryResult([
        { id: "a1", action: "UPDATE", table_name: "orders", user_id: "u2" },
      ]);
    });

    const { GET } = await import("@/app/api/audit-logs/route");
    const req = new Request("http://localhost/api/audit-logs?limit=10");
    const res = await GET(req as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].table_name).toBe("orders");
  });
});
