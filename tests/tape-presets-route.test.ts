import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthMock = vi.fn();

vi.mock("@/lib/auth/guards", () => ({
  requireAuth: requireAuthMock,
  isAuthError: vi.fn(() => false),
}));

describe("Tape Presets route", () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
  });

  it("GET blocks roles without stock visibility", async () => {
    requireAuthMock.mockResolvedValue({ userId: "u1", role: "warehouse", fullName: "Ayse Demir" });

    const { GET } = await import("@/app/api/stock/tape-presets/route");
    const res = await GET();

    expect(res.status).toBe(403);
  });

  it("GET returns preset groups for authorized users", async () => {
    requireAuthMock.mockResolvedValue({ userId: "u1", role: "accounting", fullName: "Imren" });

    const { GET } = await import("@/app/api/stock/tape-presets/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.groups.length).toBeGreaterThan(0);
    expect(typeof body.total).toBe("number");
  });

  it("POST blocks users without create permission", async () => {
    requireAuthMock.mockResolvedValue({ userId: "u1", role: "sales", fullName: "Satis User" });

    const { POST } = await import("@/app/api/stock/tape-presets/route");
    const req = new Request("http://localhost/api/stock/tape-presets", { method: "POST" });
    const res = await POST(req as any);

    expect(res.status).toBe(403);
  });
});
