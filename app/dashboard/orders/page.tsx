"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { OrderTable } from "@/components/orders/order-table";
import { OrderForm } from "@/components/orders/order-form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { Order, AppRole, Profile } from "@/lib/types";
import { canViewFinance, canManageOrders } from "@/lib/rbac";
import { toast } from "@/hooks/use-toast";

const HISTORY_ALLOWED_NAMES = ["Mustafa", "Muhammed", "İmren"];

export default function OrdersPage() {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [role, setRole] = useState<AppRole | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"active" | "history">("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [taskDialogOrder, setTaskDialogOrder] = useState<Order | null>(null);
  const [workers, setWorkers] = useState<Profile[]>([]);
  const [taskDept, setTaskDept] = useState<string>("warehouse");
  const [taskAssignee, setTaskAssignee] = useState<string>("");
  const [taskPriority, setTaskPriority] = useState<string>("normal");
  const [taskDueDate, setTaskDueDate] = useState<string>("");
  const [taskLoading, setTaskLoading] = useState(false);

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/orders");
      if (res.ok) {
        const data = await res.json();
        setAllOrders(Array.isArray(data) ? data : []);
      } else {
        console.error("Orders API error:", res.status, await res.text());
      }
    } catch (err) {
      console.error("Orders fetch error:", err);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role, full_name").eq("id", user.id).single();
      if (profile) {
        setRole(profile.role as AppRole);
        setUserName(profile.full_name || "");
      }
    });
    supabase.from("profiles").select("*").eq("active", true).then(({ data }) => {
      if (data) setWorkers(data as Profile[]);
    });
    loadOrders();
  }, [loadOrders]);

  const canSeeHistory = role === "admin" || HISTORY_ALLOWED_NAMES.includes(userName);
  const canClose = role === "accounting" || role === "admin";

  const activeOrders = useMemo(() => allOrders.filter((o) => o.status !== "closed" && o.status !== "cancelled"), [allOrders]);
  const historyOrders = useMemo(() => allOrders.filter((o) => o.status === "closed" || o.status === "cancelled"), [allOrders]);

  const orders = activeTab === "active" ? activeOrders : historyOrders;

  function handleNew() { setEditOrder(null); setFormOpen(true); }

  async function handleAssignTask() {
    if (!taskDialogOrder) return;
    setTaskLoading(true);
    try {
      const res = await fetch(`/api/orders/${taskDialogOrder.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: taskDialogOrder.id,
          department: taskDept,
          assigned_to: taskAssignee || null,
          priority: taskPriority,
          due_date: taskDueDate || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Hata");
      toast({ title: "Görev atandı" });
      setTaskDialogOrder(null);
      setTaskDept("warehouse");
      setTaskAssignee("");
      setTaskPriority("normal");
      setTaskDueDate("");
    } catch (err: unknown) {
      toast({ title: "Hata", description: err instanceof Error ? err.message : "Bilinmeyen", variant: "destructive" });
    } finally { setTaskLoading(false); }
  }

  const isManager = role ? canManageOrders(role) : false;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "active" | "history")}>
          <TabsList>
            <TabsTrigger value="active">
              Aktif Siparişler
              <Badge variant="outline" className="ml-1 text-[10px]">{activeOrders.length}</Badge>
            </TabsTrigger>
            {canSeeHistory && (
              <TabsTrigger value="history">
                Geçmiş
                <Badge variant="outline" className="ml-1 text-[10px]">{historyOrders.length}</Badge>
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
      </div>

      <OrderTable
        orders={orders}
        showFinance={role ? canViewFinance(role) : false}
        canEdit={isManager && activeTab === "active"}
        canClose={canClose && activeTab === "active"}
        onReload={loadOrders}
        onNewOrder={handleNew}
        onAssignTask={(o) => setTaskDialogOrder(o)}
      />

      <OrderForm open={formOpen} onOpenChange={setFormOpen} onSuccess={loadOrders} editOrder={editOrder} showFinance={role ? canViewFinance(role) : false} />

      <Dialog open={!!taskDialogOrder} onOpenChange={(v) => { if (!v) setTaskDialogOrder(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Görev Ata — {taskDialogOrder?.order_no}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Departman</Label>
              <Select value={taskDept} onValueChange={setTaskDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warehouse">Depo</SelectItem>
                  <SelectItem value="production">Üretim</SelectItem>
                  <SelectItem value="shipping">Sevkiyat</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Atanan Kişi (opsiyonel)</Label>
              <Select value={taskAssignee || "__all__"} onValueChange={(v) => setTaskAssignee(v === "__all__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Seçin..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Herkese (departman)</SelectItem>
                  {workers.filter((w) => w.role === taskDept).map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Öncelik</Label>
              <Select value={taskPriority} onValueChange={setTaskPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Düşük</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Yüksek</SelectItem>
                  <SelectItem value="urgent">Acil</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Termin Tarihi</Label>
              <Input type="date" value={taskDueDate} onChange={(e) => setTaskDueDate(e.target.value)} />
            </div>
            <Button className="w-full" onClick={handleAssignTask} disabled={taskLoading}>
              {taskLoading ? "Atanıyor..." : "Görevi Ata"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
