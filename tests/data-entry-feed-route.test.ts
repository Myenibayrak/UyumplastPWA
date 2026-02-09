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

function createThenable(result: { data: unknown; error: unknown }) {
  const query: {
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    gte: ReturnType<typeof vi.fn>;
    then: (onfulfilled: (value: { data: unknown; error: unknown }) => unknown) => Promise<unknown>;
  } = {
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    gte: vi.fn(() => query),
    then: (onfulfilled) => Promise.resolve(onfulfilled(result)),
  };

  return query;
}

describe("Data Entry Feed route", () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    fromMock.mockReset();
  });

  it("blocks non-admin roles", async () => {
    requireAuthMock.mockResolvedValue({ userId: "u1", role: "sales", fullName: "Harun" });

    const { GET } = await import("@/app/api/data-entry-feed/route");
    const res = await GET(new Request("http://localhost/api/data-entry-feed") as any);

    expect(res.status).toBe(403);
  });

  it("returns mapped row data for admin", async () => {
    requireAuthMock.mockResolvedValue({ userId: "u1", role: "admin", fullName: "Muhammed" });

    const query = createThenable({
      data: [
        {
          id: "log-1",
          user_id: "u2",
          action: "INSERT",
          table_name: "order_stock_entries",
          record_id: "r1",
          old_data: null,
          new_data: { bobbin_label: "STK-1", kg: 12 },
          created_at: "2026-02-09T00:00:00.000Z",
          actor: { full_name: "Ugur Turgay", role: "warehouse" },
        },
      ],
      error: null,
    });

    const selectMock = vi.fn(() => query);
    fromMock.mockReturnValue({ select: selectMock });

    const { GET } = await import("@/app/api/data-entry-feed/route");
    const res = await GET(new Request("http://localhost/api/data-entry-feed?mode=entries") as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.rows[0].row_data).toEqual({ bobbin_label: "STK-1", kg: 12 });
    expect(query.in).toHaveBeenCalled();
  });
});
