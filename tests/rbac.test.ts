import { describe, it, expect } from "vitest";
import {
  isWorkerRole,
  isFinanceRole,
  canViewFinance,
  canManageOrders,
  canEditOrderDetails,
  canAssignTasks,
  canViewAllOrders,
  canEditSettings,
  canViewStock,
  canCloseOrders,
  canCreateStock,
  canEditStock,
  canUseWarehouseEntry,
  canUseBobinEntry,
  canManageProductionPlans,
  canViewOrderHistory,
  canViewAuditTrail,
  resolveRoleByIdentity,
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

  describe("canEditOrderDetails", () => {
    it("admin, sales and accounting can edit order detail fields", () => {
      expect(canEditOrderDetails("admin")).toBe(true);
      expect(canEditOrderDetails("sales")).toBe(true);
      expect(canEditOrderDetails("accounting")).toBe(true);
    });
    it("worker roles cannot edit order detail fields", () => {
      expect(canEditOrderDetails("warehouse")).toBe(false);
      expect(canEditOrderDetails("production")).toBe(false);
      expect(canEditOrderDetails("shipping")).toBe(false);
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

  describe("canViewStock", () => {
    it("allows sales role", () => {
      expect(canViewStock("sales", "Rastgele Kullanıcı")).toBe(true);
      expect(canViewStock("accounting", "Rastgele Kullanıcı")).toBe(false);
    });
    it("allows Muhammed and Mustafa by name regardless of role", () => {
      expect(canViewStock("admin", "Muhammed Yenibayrak")).toBe(true);
      expect(canViewStock("admin", "Mustafa Yılmaz")).toBe(true);
      expect(canViewStock("admin", "İmren Kaya")).toBe(false);
    });
    it("allows Muhammed and Mustafa by name", () => {
      expect(canViewStock("warehouse", "Muhammed Yenibayrak")).toBe(true);
      expect(canViewStock("shipping", "Mustafa Yılmaz")).toBe(true);
    });
    it("allows factory manager by title", () => {
      expect(canViewStock("production", "Fabrika Müdürü Ahmet")).toBe(true);
    });
    it("blocks others", () => {
      expect(canViewStock("warehouse", "Ayşe Demir")).toBe(false);
      expect(canViewStock("production", "İmren Kaya")).toBe(false);
    });
  });

  describe("operation permissions", () => {
    it("order close permission", () => {
      expect(canCloseOrders("admin")).toBe(true);
      expect(canCloseOrders("accounting")).toBe(true);
      expect(canCloseOrders("sales")).toBe(false);
    });

    it("stock create/edit permissions", () => {
      expect(canCreateStock("accounting")).toBe(true);
      expect(canCreateStock("warehouse")).toBe(false);
      expect(canEditStock("warehouse")).toBe(false);
      expect(canEditStock("admin")).toBe(true);
      expect(canEditStock("accounting")).toBe(false);
    });

    it("entry screen permissions", () => {
      expect(canUseWarehouseEntry("warehouse")).toBe(true);
      expect(canUseWarehouseEntry("production")).toBe(false);
      expect(canUseBobinEntry("production")).toBe(true);
      expect(canUseBobinEntry("shipping")).toBe(false);
    });

    it("production plan management permission", () => {
      expect(canManageProductionPlans("admin")).toBe(true);
      expect(canManageProductionPlans("production")).toBe(true);
      expect(canManageProductionPlans("sales")).toBe(true);
    });

    it("history and audit visibility", () => {
      expect(canViewOrderHistory("admin", "Admin User")).toBe(true);
      expect(canViewOrderHistory("sales", "Muhammed Yenibayrak")).toBe(true);
      expect(canViewOrderHistory("sales", "Ayşe Demir")).toBe(false);
      expect(canViewAuditTrail("admin")).toBe(true);
      expect(canViewAuditTrail("sales")).toBe(true);
      expect(canViewAuditTrail("accounting")).toBe(true);
      expect(canViewAuditTrail("warehouse")).toBe(false);
    });
  });

  describe("resolveRoleByIdentity", () => {
    it("maps required people to expected roles", () => {
      expect(resolveRoleByIdentity("warehouse", "Uğur Turgay")).toBe("warehouse");
      expect(resolveRoleByIdentity("warehouse", "Turgut Yılmaz")).toBe("shipping");
      expect(resolveRoleByIdentity("sales", "Esat Kaya")).toBe("production");
      expect(resolveRoleByIdentity("sales", "Gökhan Demir")).toBe("production");
      expect(resolveRoleByIdentity("shipping", "Mehmet Ali Çetin")).toBe("production");
      expect(resolveRoleByIdentity("warehouse", "Harun Musa")).toBe("sales");
      expect(resolveRoleByIdentity("sales", "Mustafa Özcan")).toBe("admin");
      expect(resolveRoleByIdentity("production", "Muhammed Yenibayrak")).toBe("admin");
    });

    it("falls back to stored role when no override exists", () => {
      expect(resolveRoleByIdentity("shipping", "Ayşe Demir")).toBe("shipping");
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
