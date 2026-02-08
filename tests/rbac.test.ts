import { describe, it, expect } from "vitest";
import {
  isWorkerRole,
  isFinanceRole,
  canViewFinance,
  canManageOrders,
  canAssignTasks,
  canViewAllOrders,
  canEditSettings,
  hasAnyRole,
  stripFinanceFields,
} from "@/lib/rbac";
import type { AppRole } from "@/lib/types";

describe("RBAC helpers", () => {
  describe("isWorkerRole", () => {
    it("returns true for warehouse, production, shipping", () => {
      expect(isWorkerRole("warehouse")).toBe(true);
      expect(isWorkerRole("production")).toBe(true);
      expect(isWorkerRole("shipping")).toBe(true);
    });
    it("returns false for admin, sales, accounting", () => {
      expect(isWorkerRole("admin")).toBe(false);
      expect(isWorkerRole("sales")).toBe(false);
      expect(isWorkerRole("accounting")).toBe(false);
    });
  });

  describe("isFinanceRole", () => {
    it("returns true for admin, sales, accounting", () => {
      expect(isFinanceRole("admin")).toBe(true);
      expect(isFinanceRole("sales")).toBe(true);
      expect(isFinanceRole("accounting")).toBe(true);
    });
    it("returns false for worker roles", () => {
      expect(isFinanceRole("warehouse")).toBe(false);
      expect(isFinanceRole("production")).toBe(false);
      expect(isFinanceRole("shipping")).toBe(false);
    });
  });

  describe("canViewFinance", () => {
    it("admin, sales, accounting can view finance", () => {
      expect(canViewFinance("admin")).toBe(true);
      expect(canViewFinance("sales")).toBe(true);
      expect(canViewFinance("accounting")).toBe(true);
    });
    it("workers cannot view finance", () => {
      expect(canViewFinance("warehouse")).toBe(false);
      expect(canViewFinance("production")).toBe(false);
      expect(canViewFinance("shipping")).toBe(false);
    });
  });

  describe("canManageOrders", () => {
    it("admin and sales can manage orders", () => {
      expect(canManageOrders("admin")).toBe(true);
      expect(canManageOrders("sales")).toBe(true);
    });
    it("others cannot manage orders", () => {
      expect(canManageOrders("warehouse")).toBe(false);
      expect(canManageOrders("accounting")).toBe(false);
    });
  });

  describe("canAssignTasks", () => {
    it("admin and sales can assign tasks", () => {
      expect(canAssignTasks("admin")).toBe(true);
      expect(canAssignTasks("sales")).toBe(true);
    });
    it("workers cannot assign tasks", () => {
      expect(canAssignTasks("warehouse")).toBe(false);
    });
  });

  describe("canEditSettings", () => {
    it("only admin can edit settings", () => {
      expect(canEditSettings("admin")).toBe(true);
      expect(canEditSettings("sales")).toBe(false);
      expect(canEditSettings("warehouse")).toBe(false);
    });
  });

  describe("hasAnyRole", () => {
    it("returns true when role is in allowed list", () => {
      expect(hasAnyRole("admin", ["admin", "sales"])).toBe(true);
    });
    it("returns false when role is not in allowed list", () => {
      expect(hasAnyRole("warehouse", ["admin", "sales"])).toBe(false);
    });
  });

  describe("stripFinanceFields", () => {
    it("removes price, payment_term, currency from object", () => {
      const order = {
        id: "1",
        customer: "Test",
        price: 100,
        payment_term: "30 days",
        currency: "TRY",
        status: "draft",
      };
      const stripped = stripFinanceFields(order);
      expect(stripped).not.toHaveProperty("price");
      expect(stripped).not.toHaveProperty("payment_term");
      expect(stripped).not.toHaveProperty("currency");
      expect(stripped).toHaveProperty("id");
      expect(stripped).toHaveProperty("customer");
      expect(stripped).toHaveProperty("status");
    });
  });
});
