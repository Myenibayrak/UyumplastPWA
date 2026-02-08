import { describe, it, expect } from "vitest";

describe("Setup System Route", () => {
  const baseUrl = "http://localhost:3000/api/setup-system";

  describe("Authentication", () => {
    it("rejects requests without token", async () => {
      const mockReq = new Request(baseUrl);
      const { GET } = await import("@/app/api/setup-system/route");
      const res = await GET(mockReq as any);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("rejects requests with wrong token", async () => {
      const mockReq = new Request(`${baseUrl}?token=wrong-token`);
      const { GET } = await import("@/app/api/setup-system/route");
      const res = await GET(mockReq as any);
      expect(res.status).toBe(401);
    });
  });
});
