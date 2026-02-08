"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/types";
import {
  LogOut, Menu, X,
  Package, ClipboardList, Settings, LayoutDashboard,
  Wrench,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles?: AppRole[];
}

// Role bazlı menü tanımları
const MENU_BY_ROLE: Record<AppRole, NavItem[]> = {
  admin: [
    { href: "/dashboard/orders", label: "Siparişler", icon: <Package className="h-5 w-5" /> },
    { href: "/dashboard/tasks", label: "Görevler", icon: <ClipboardList className="h-5 w-5" /> },
    { href: "/dashboard/production", label: "Üretim Planları", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/dashboard/bobin-entry", label: "Bobin Girişi", icon: <Wrench className="h-5 w-5" /> },
    { href: "/dashboard/warehouse-entry", label: "Depo Girişi", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/dashboard/stock", label: "Stok", icon: <Package className="h-5 w-5" /> },
    { href: "/dashboard/settings", label: "Ayarlar", icon: <Settings className="h-5 w-5" /> },
  ],
  sales: [
    { href: "/dashboard/orders", label: "Siparişler", icon: <Package className="h-5 w-5" /> },
    { href: "/dashboard/tasks", label: "Görevler", icon: <ClipboardList className="h-5 w-5" /> },
    { href: "/dashboard/production", label: "Üretim", icon: <LayoutDashboard className="h-5 w-5" /> },
  ],
  production: [
    { href: "/dashboard/tasks", label: "Görevlerim", icon: <ClipboardList className="h-5 w-5" /> },
    { href: "/dashboard/production", label: "Üretim Planları", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/dashboard/bobin-entry", label: "Bobin Girişi", icon: <Wrench className="h-5 w-5" /> },
  ],
  warehouse: [
    { href: "/dashboard/orders", label: "Siparişler", icon: <Package className="h-5 w-5" /> },
    { href: "/dashboard/tasks", label: "Görevlerim", icon: <ClipboardList className="h-5 w-5" /> },
    { href: "/dashboard/warehouse-entry", label: "Depo Girişi", icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: "/dashboard/stock", label: "Stok", icon: <Package className="h-5 w-5" /> },
  ],
  shipping: [
    { href: "/dashboard/orders", label: "Siparişler", icon: <Package className="h-5 w-5" /> },
    { href: "/dashboard/tasks", label: "Görevlerim", icon: <ClipboardList className="h-5 w-5" /> },
  ],
  accounting: [
    { href: "/dashboard/orders", label: "Siparişler", icon: <Package className="h-5 w-5" /> },
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
        setRole(profile.role as AppRole);
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
  const navItems: NavItem[] = role ? MENU_BY_ROLE[role] : [];

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
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  pathname === item.href || pathname.startsWith(item.href + "/")
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
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
