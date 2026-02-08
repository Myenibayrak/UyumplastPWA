"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, ClipboardList, CheckCircle, AlertTriangle } from "lucide-react";
import type { AppRole } from "@/lib/types";
import { isWorkerRole } from "@/lib/rbac";
import { useRouter } from "next/navigation";

interface DashboardStats {
  totalOrders: number;
  pendingTasks: number;
  completedToday: number;
  urgentTasks: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({ totalOrders: 0, pendingTasks: 0, completedToday: 0, urgentTasks: 0 });
  const [role, setRole] = useState<AppRole | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (profile) {
        const r = profile.role as AppRole;
        setRole(r);
        if (isWorkerRole(r)) {
          router.replace("/dashboard/tasks");
          return;
        }
      }

      const [ordersRes, pendingRes, completedRes, urgentRes] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }),
        supabase.from("order_tasks").select("id", { count: "exact", head: true }).in("status", ["pending", "in_progress", "preparing"]),
        supabase.from("order_tasks").select("id", { count: "exact", head: true }).eq("status", "done").gte("updated_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
        supabase.from("order_tasks").select("id", { count: "exact", head: true }).eq("priority", "urgent").neq("status", "done").neq("status", "cancelled"),
      ]);
      setStats({
        totalOrders: ordersRes.count ?? 0,
        pendingTasks: pendingRes.count ?? 0,
        completedToday: completedRes.count ?? 0,
        urgentTasks: urgentRes.count ?? 0,
      });
    });
  }, [router]);

  const cards = [
    { title: "Toplam Sipariş", value: stats.totalOrders, icon: <Package className="h-6 w-6 text-blue-500" />, color: "text-blue-600" },
    { title: "Bekleyen Görevler", value: stats.pendingTasks, icon: <ClipboardList className="h-6 w-6 text-orange-500" />, color: "text-orange-600" },
    { title: "Bugün Tamamlanan", value: stats.completedToday, icon: <CheckCircle className="h-6 w-6 text-green-500" />, color: "text-green-600" },
    { title: "Acil Görevler", value: stats.urgentTasks, icon: <AlertTriangle className="h-6 w-6 text-red-500" />, color: "text-red-600" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Panel</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              {card.icon}
            </CardHeader>
            <CardContent>
              <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
