"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { canCreateStock, canViewAuditTrail, canViewHandover, canViewShippingSchedule, canViewStock, resolveRoleByIdentity } from "@/lib/rbac";
import type { AppRole } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/types";
import {
  LogOut, Menu, X,
  Package, ClipboardList, Settings, LayoutDashboard,
  Wrench, Warehouse, Factory, ShieldCheck, Truck, Workflow, MessageSquareMore, Database, ClipboardCheck,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles?: AppRole[];
}

const MOBILE_LABELS: Record<string, string> = {
  "/dashboard": "Panel",
  "/dashboard/orders": "Sipariş",
  "/dashboard/tasks": "Görev",
  "/dashboard/messages": "Mesaj",
  "/dashboard/stock": "Stok",
  "/dashboard/shipping-plan": "Sevkiyat",
  "/dashboard/data-entry": "Veri",
  "/dashboard/handover": "Devir",
};

// Role bazlı menü tanımları
const MENU_BY_ROLE: Record<AppRole, NavItem[]> = {
  admin: [
    { href: "/dashboard", label: "Genel Durum", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/dashboard/orders", label: "Siparişler", icon: <Package className="h-5 w-5" /> },
    { href: "/dashboard/tasks", label: "Görevler", icon: <ClipboardList className="h-5 w-5" /> },
    { href: "/dashboard/messages", label: "Mesajlar", icon: <MessageSquareMore className="h-5 w-5" /> },
    { href: "/dashboard/workflow", label: "İş Akışı", icon: <Workflow className="h-5 w-5" /> },
    { href: "/dashboard/handover", label: "Devir-Teslim", icon: <ClipboardCheck className="h-5 w-5" /> },
    { href: "/dashboard/shipping-plan", label: "Sevkiyat Programı", icon: <Truck className="h-5 w-5" /> },
    { href: "/dashboard/production", label: "Üretim Planları", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/dashboard/bobin-entry", label: "Bobin Girişi", icon: <Wrench className="h-5 w-5" /> },
    { href: "/dashboard/warehouse-entry", label: "Depo Girişi", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/dashboard/stock", label: "Stok", icon: <Package className="h-5 w-5" /> },
    { href: "/dashboard/data-entry", label: "Canlı Veri", icon: <Database className="h-5 w-5" /> },
    { href: "/dashboard/transparency", label: "İşlem Geçmişi", icon: <ShieldCheck className="h-5 w-5" /> },
    { href: "/dashboard/settings", label: "Ayarlar", icon: <Settings className="h-5 w-5" /> },
  ],
  sales: [
    { href: "/dashboard", label: "Genel Durum", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/dashboard/orders", label: "Siparişler", icon: <Package className="h-5 w-5" /> },
    { href: "/dashboard/tasks", label: "Görevler", icon: <ClipboardList className="h-5 w-5" /> },
    { href: "/dashboard/messages", label: "Mesajlar", icon: <MessageSquareMore className="h-5 w-5" /> },
    { href: "/dashboard/workflow", label: "İş Akışı", icon: <Workflow className="h-5 w-5" /> },
    { href: "/dashboard/handover", label: "Devir-Teslim", icon: <ClipboardCheck className="h-5 w-5" /> },
    { href: "/dashboard/shipping-plan", label: "Sevkiyat Programı", icon: <Truck className="h-5 w-5" /> },
    { href: "/dashboard/production", label: "Üretim", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/dashboard/stock", label: "Stok Takibi", icon: <Package className="h-5 w-5" /> },
    { href: "/dashboard/transparency", label: "İşlem Geçmişi", icon: <ShieldCheck className="h-5 w-5" /> },
  ],
  production: [
    { href: "/dashboard/tasks", label: "Görevlerim", icon: <ClipboardList className="h-5 w-5" /> },
    { href: "/dashboard/messages", label: "Mesajlar", icon: <MessageSquareMore className="h-5 w-5" /> },
    { href: "/dashboard/workflow", label: "İş Akışı", icon: <Workflow className="h-5 w-5" /> },
    { href: "/dashboard/handover", label: "Devir-Teslim", icon: <ClipboardCheck className="h-5 w-5" /> },
    { href: "/dashboard/bobin-entry", label: "Bobin Girişi", icon: <Wrench className="h-5 w-5" /> },
    { href: "/dashboard/production", label: "Üretim Planları", icon: <Factory className="h-5 w-5" /> },
    { href: "/dashboard/orders", label: "Siparişler", icon: <Package className="h-5 w-5" /> },
  ],
  warehouse: [
    { href: "/dashboard/tasks", label: "Görevlerim", icon: <ClipboardList className="h-5 w-5" /> },
    { href: "/dashboard/messages", label: "Mesajlar", icon: <MessageSquareMore className="h-5 w-5" /> },
    { href: "/dashboard/workflow", label: "İş Akışı", icon: <Workflow className="h-5 w-5" /> },
    { href: "/dashboard/handover", label: "Devir-Teslim", icon: <ClipboardCheck className="h-5 w-5" /> },
    { href: "/dashboard/warehouse-entry", label: "Depo Girişi", icon: <Warehouse className="h-5 w-5" /> },
    { href: "/dashboard/stock", label: "Stok", icon: <Package className="h-5 w-5" /> },
    { href: "/dashboard/orders", label: "Siparişler", icon: <Package className="h-5 w-5" /> },
  ],
  shipping: [
    { href: "/dashboard/tasks", label: "Görevlerim", icon: <ClipboardList className="h-5 w-5" /> },
    { href: "/dashboard/messages", label: "Mesajlar", icon: <MessageSquareMore className="h-5 w-5" /> },
    { href: "/dashboard/workflow", label: "İş Akışı", icon: <Workflow className="h-5 w-5" /> },
    { href: "/dashboard/handover", label: "Devir-Teslim", icon: <ClipboardCheck className="h-5 w-5" /> },
    { href: "/dashboard/shipping-plan", label: "Sevkiyat Programı", icon: <Truck className="h-5 w-5" /> },
    { href: "/dashboard/orders", label: "Siparişler", icon: <Package className="h-5 w-5" /> },
  ],
  accounting: [
    { href: "/dashboard", label: "Genel Durum", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/dashboard/orders", label: "Siparişler", icon: <Package className="h-5 w-5" /> },
    { href: "/dashboard/messages", label: "Mesajlar", icon: <MessageSquareMore className="h-5 w-5" /> },
    { href: "/dashboard/workflow", label: "İş Akışı", icon: <Workflow className="h-5 w-5" /> },
    { href: "/dashboard/handover", label: "Devir-Teslim", icon: <ClipboardCheck className="h-5 w-5" /> },
    { href: "/dashboard/stock", label: "Stok Girişi", icon: <Package className="h-5 w-5" /> },
    { href: "/dashboard/transparency", label: "İşlem Geçmişi", icon: <ShieldCheck className="h-5 w-5" /> },
  ],
};

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<AppRole | null>(null);
  const [fullName, setFullName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push("/login"); return; }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", user.id)
        .single();
      if (profile) {
        const resolved = resolveRoleByIdentity(profile.role as AppRole, profile.full_name || "");
        if (resolved) setRole(resolved);
        setFullName(profile.full_name);
      }
    });
  }, [router]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Role'a göre menü
  const navItems: NavItem[] = role
    ? (() => {
        const base = MENU_BY_ROLE[role];
        const hasStockAccess = canViewStock(role, fullName) || canCreateStock(role);
        const hasShippingPlanAccess = canViewShippingSchedule(role, fullName);
        const hasAuditTrailAccess = canViewAuditTrail(role);
        const hasHandoverAccess = canViewHandover(role);
        const filtered = base.filter((item) => {
          if (item.href === "/dashboard/stock") return hasStockAccess;
          if (item.href === "/dashboard/shipping-plan") return hasShippingPlanAccess;
          if (item.href === "/dashboard/transparency") return hasAuditTrailAccess;
          if (item.href === "/dashboard/handover") return hasHandoverAccess;
          return true;
        });
        if (hasStockAccess && !filtered.some((item) => item.href === "/dashboard/stock")) {
          filtered.push({ href: "/dashboard/stock", label: canViewStock(role, fullName) ? "Stok" : "Stok Girişi", icon: <Package className="h-5 w-5" /> });
        }
        if (hasShippingPlanAccess && !filtered.some((item) => item.href === "/dashboard/shipping-plan")) {
          filtered.push({ href: "/dashboard/shipping-plan", label: "Sevkiyat Programı", icon: <Truck className="h-5 w-5" /> });
        }
        if (hasAuditTrailAccess && !filtered.some((item) => item.href === "/dashboard/transparency")) {
          filtered.push({ href: "/dashboard/transparency", label: "İşlem Geçmişi", icon: <ShieldCheck className="h-5 w-5" /> });
        }
        if (hasHandoverAccess && !filtered.some((item) => item.href === "/dashboard/handover")) {
          filtered.push({ href: "/dashboard/handover", label: "Devir-Teslim", icon: <ClipboardCheck className="h-5 w-5" /> });
        }
        return filtered;
      })()
    : [];

  const mobileQuickItems: NavItem[] = (() => {
    const preferred = [
      "/dashboard",
      "/dashboard/orders",
      "/dashboard/tasks",
      "/dashboard/messages",
      "/dashboard/stock",
      "/dashboard/shipping-plan",
      "/dashboard/workflow",
    ];
    const selected = preferred
      .map((href) => navItems.find((item) => item.href === href))
      .filter((item): item is NavItem => Boolean(item))
      .slice(0, 4);

    if (selected.length < 4) {
      for (const item of navItems) {
        if (selected.some((s) => s.href === item.href)) continue;
        selected.push(item);
        if (selected.length >= 4) break;
      }
    }
    return selected;
  })();

  const isActiveLink = (href: string) =>
    href === "/dashboard"
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  if (!role) {
    return <div className="min-h-screen flex items-center justify-center"><p>Yükleniyor...</p></div>;
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform lg:translate-x-0 lg:static lg:z-auto",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <h1 className="text-xl font-bold text-blue-600">Uyumplast</h1>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  isActiveLink(item.href)
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </nav>

          {/* User info */}
          <div className="p-4 border-t border-slate-200 bg-slate-50">
            <div className="mb-3">
              <p className="text-sm font-medium text-slate-900 truncate">{fullName}</p>
              <p className="text-xs text-slate-500">{ROLE_LABELS[role]}</p>
            </div>
            <Button variant="ghost" size="sm" className="w-full justify-start text-slate-600 hover:text-slate-900" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Çıkış Yap
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-slate-200 bg-white">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
          <NotificationBell />
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto pb-24 lg:pb-6">
          {children}
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="grid grid-cols-5">
          {mobileQuickItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium",
                isActiveLink(item.href) ? "text-blue-700" : "text-slate-600"
              )}
            >
              <span className="h-4 w-4">{item.icon}</span>
              <span className="truncate max-w-[72px]">{MOBILE_LABELS[item.href] || item.label}</span>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium text-slate-600"
          >
            <Menu className="h-4 w-4" />
            <span>Menü</span>
          </button>
        </div>
      </div>
    </div>
  );
}
