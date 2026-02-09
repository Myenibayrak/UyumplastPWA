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

describe("Handover notes routes", () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    fromMock.mockReset();
  });

  it("POST blocks non-manager from writing another department", async () => {
    requireAuthMock.mockResolvedValue({ userId: "u-1", role: "warehouse", fullName: "Ugur Turgay" });

    const { POST } = await import("@/app/api/handover-notes/route");
    const req = new Request("http://localhost/api/handover-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        department: "production",
        shift_date: "2026-02-09",
        title: "Makine Notu",
        details: "Detay",
        priority: "normal",
      }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(403);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("POST creates handover note and notifies recipients", async () => {
    requireAuthMock.mockResolvedValue({ userId: "u-1", role: "admin", fullName: "Muhammed" });

    const insertedRow = {
      id: "h-1",
      department: "production",
      shift_date: "2026-02-09",
      title: "Vardiya Notu",
      details: "Detay",
      priority: "high",
      status: "open",
      created_by: "u-1",
      resolved_by: null,
    };

    const handoverInsertSingleMock = vi.fn().mockResolvedValue({ data: insertedRow, error: null });
    const handoverInsertSelectMock = vi.fn(() => ({ single: handoverInsertSingleMock }));
    const handoverInsertMock = vi.fn(() => ({ select: handoverInsertSelectMock }));

    const profilesOrMock = vi.fn().mockResolvedValue({ data: [{ id: "u-2", role: "production" }, { id: "u-1", role: "admin" }], error: null });
    const profilesSelectMock = vi.fn(() => ({ or: profilesOrMock }));

    const notificationsInsertMock = vi.fn().mockResolvedValue({ error: null });
    const auditInsertMock = vi.fn().mockResolvedValue({ error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === "handover_notes") return { insert: handoverInsertMock };
      if (table === "profiles") return { select: profilesSelectMock };
      if (table === "notifications") return { insert: notificationsInsertMock };
      if (table === "audit_logs") return { insert: auditInsertMock };
      throw new Error(`Unexpected table ${table}`);
    });

    const { POST } = await import("@/app/api/handover-notes/route");
    const req = new Request("http://localhost/api/handover-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        department: "production",
        shift_date: "2026-02-09",
        title: "Vardiya Notu",
        details: "Detay",
        priority: "high",
      }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(201);
    expect(handoverInsertMock).toHaveBeenCalledWith(expect.objectContaining({ created_by: "u-1" }));
    expect(notificationsInsertMock).toHaveBeenCalledTimes(1);
  });

  it("PATCH marks note as resolved with resolver metadata", async () => {
    requireAuthMock.mockResolvedValue({ userId: "u-1", role: "admin", fullName: "Muhammed" });

    const beforeRow = {
      id: "h-1",
      department: "production",
      shift_date: "2026-02-09",
      title: "Not",
      details: "Detay",
      priority: "normal",
      status: "open",
      created_by: "u-2",
      resolved_by: null,
    };

    const afterRow = {
      ...beforeRow,
      status: "resolved",
      resolved_by: "u-1",
      resolved_note: "Tamam",
    };

    const beforeSingleMock = vi.fn().mockResolvedValue({ data: beforeRow, error: null });
    const beforeEqMock = vi.fn(() => ({ single: beforeSingleMock }));
    const beforeSelectMock = vi.fn(() => ({ eq: beforeEqMock }));

    const updateSingleMock = vi.fn().mockResolvedValue({ data: afterRow, error: null });
    const updateSelectMock = vi.fn(() => ({ single: updateSingleMock }));
    const updateEqMock = vi.fn(() => ({ select: updateSelectMock }));
    const updateMock = vi.fn(() => ({ eq: updateEqMock }));

    const auditInsertMock = vi.fn().mockResolvedValue({ error: null });

    const handoverFromMock = {
      select: beforeSelectMock,
      update: updateMock,
    };

    fromMock.mockImplementation((table: string) => {
      if (table === "handover_notes") return handoverFromMock;
      if (table === "audit_logs") return { insert: auditInsertMock };
      throw new Error(`Unexpected table ${table}`);
    });

    const { PATCH } = await import("@/app/api/handover-notes/[id]/route");
    const req = new Request("http://localhost/api/handover-notes/h-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved", resolved_note: "Tamam" }),
    });

    const res = await PATCH(req as any, { params: { id: "h-1" } });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved",
      resolved_by: "u-1",
      resolved_note: "Tamam",
    }));
  });
});
