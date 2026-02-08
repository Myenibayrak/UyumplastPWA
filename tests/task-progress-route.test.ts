import { describe, it, expect } from "vitest";
import { taskProgressSchema } from "@/lib/validations";

describe("Task Progress Validation", () => {
  it("accepts valid task progress update", () => {
    const result = taskProgressSchema.safeParse({
      status: "in_progress",
      ready_quantity: 50,
      progress_note: "Started processing",
    });
    expect(result.success).toBe(true);
  });

  it("accepts minimal update with just status", () => {
    const result = taskProgressSchema.safeParse({ status: "done" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = taskProgressSchema.safeParse({ status: "invalid_status" });
    expect(result.success).toBe(false);
  });

  it("rejects missing status", () => {
    const result = taskProgressSchema.safeParse({ ready_quantity: 10 });
    expect(result.success).toBe(false);
  });

  it("accepts all valid statuses", () => {
    const statuses = ["pending", "in_progress", "preparing", "ready", "done", "cancelled"];
    statuses.forEach((status) => {
      const result = taskProgressSchema.safeParse({ status });
      expect(result.success).toBe(true);
    });
  });
});
