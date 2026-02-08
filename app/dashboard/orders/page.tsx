"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { OrderForm } from "@/components/orders/order-form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { Order, AppRole, Profile } from "@/lib/types";
import { canViewFinance, canManageOrders, isWorkerRole } from "@/lib/rbac";
import { ORDER_STATUS_LABELS, SOURCE_TYPE_ICONS } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import { Plus, Search } from "lucide-react";

function normalizeTurkishName(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

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
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setAllOrders(Array.isArray(data) ? data : []);
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
    supabase.from("profiles").select("*").in("role", ["warehouse", "production", "shipping"]).then(({ data }) => {
      if (data) setWorkers(data as Profile[]);
    });
    loadOrders();
  }, [loadOrders]);

  const canClose = role === "accounting" || role === "admin";
  const isManager = role ? canManageOrders(role) : false;
  const isWorker = role ? isWorkerRole(role) : false;
  const showFinance = role ? canViewFinance(role) : false;
  const canViewHistory = useMemo(() => {
    if (role === "admin" || role === "accounting") return true;
    const normalized = normalizeTurkishName(userName || "");
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens.some((token) => ["mustafa", "muhammed", "admin", "imren"].includes(token));
  }, [role, userName]);

  useEffect(() => {
    if (!canViewHistory && activeTab === "history") {
      setActiveTab("active");
    }
  }, [activeTab, canViewHistory]);

  // Filter orders
  const filteredOrders = useMemo(() => {
    return allOrders.filter((o) => {
      // Tab filter
      const isActive = o.status !== "closed" && o.status !== "cancelled";
      if (activeTab === "active" && !isActive) return false;
      if (activeTab === "history" && isActive) return false;

      // Status filter
      if (statusFilter !== "all" && o.status !== statusFilter) return false;

      // Search
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          o.order_no?.toLowerCase().includes(query) ||
          o.customer?.toLowerCase().includes(query) ||
          o.product_type?.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [allOrders, activeTab, statusFilter, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const active = allOrders.filter((o) => o.status !== "closed" && o.status !== "cancelled");
    const history = allOrders.filter((o) => o.status === "closed" || o.status === "cancelled");
    const ready = active.filter((o) => {
      const qty = Number(o.quantity || 0);
      if (qty <= 0) return false;
      const totalReady = Number(o.stock_ready_kg || 0) + Number(o.production_ready_kg || 0);
      return totalReady >= qty * 0.95;
    });

    return { total: allOrders.length, active: active.length, history: history.length, ready: ready.length };
  }, [allOrders]);

  function handleNew() { setEditOrder(null); setFormOpen(true); }
  function handleOrderPatched(updated: Order) {
    setAllOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
  }

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

  async function closeOrder(order: Order) {
    try {
      if (!confirm(`${order.order_no} siparişini kapatmak istediğinize emin misiniz?`)) return;
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      if (!res.ok) throw new Error("Hata");
      const updated = await res.json();
      handleOrderPatched(updated);
      toast({ title: "Sipariş kapatıldı" });
    } catch {
      toast({ title: "Hata", variant: "destructive" });
    }
  }

  // Helper: Calculate ready percentage
  function getReadyPercent(order: Order): number {
    const qty = Number(order.quantity || 0);
    if (qty <= 0) return 0;
    const totalReady = Number(order.stock_ready_kg || 0) + Number(order.production_ready_kg || 0);
    return Math.min(100, (totalReady / qty) * 100);
  }

  // Helper: Status badge color
  function getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      draft: "bg-slate-100 text-slate-700",
      confirmed: "bg-blue-100 text-blue-700",
      in_production: "bg-yellow-100 text-yellow-800",
      ready: "bg-green-100 text-green-700",
      shipped: "bg-purple-100 text-purple-700",
      delivered: "bg-emerald-100 text-emerald-700",
      cancelled: "bg-red-100 text-red-700",
      closed: "bg-slate-200 text-slate-600",
    };
    return colors[status] || "bg-slate-100 text-slate-700";
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Siparişler</h1>
          <p className="text-sm text-slate-500">
            {activeTab === "active" ? "Aktif siparişler" : "Geçmiş siparişler"}
          </p>
        </div>
        {isManager && activeTab === "active" && (
          <Button onClick={handleNew} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Yeni Sipariş
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Toplam</p>
          <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Aktif</p>
          <p className="text-2xl font-bold text-blue-600">{stats.active}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Hazır</p>
          <p className="text-2xl font-bold text-green-600">{stats.ready}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Geçmiş</p>
          <p className="text-2xl font-bold text-slate-600">{stats.history}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-white rounded-lg border border-slate-200 p-3">
        {/* Tab Toggle */}
        <div className="flex bg-slate-100 rounded-lg p-1">
          <button
            onClick={() => setActiveTab("active")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === "active" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
            }`}
          >
            Aktif
          </button>
          {canViewHistory && (
            <button
              onClick={() => setActiveTab("history")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "history" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
              }`}
            >
              Geçmiş
            </button>
          )}
        </div>

        {/* Status Filter */}
        {isWorker ? (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Durum" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="in_production">Hazırlanıyor</SelectItem>
              <SelectItem value="confirmed">Onaylı</SelectItem>
              <SelectItem value="ready">Hazır</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Durum" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="draft">Taslak</SelectItem>
              <SelectItem value="confirmed">Onaylı</SelectItem>
              <SelectItem value="in_production">Üretimde</SelectItem>
              <SelectItem value="ready">Hazır</SelectItem>
              <SelectItem value="shipped">Sevk Edildi</SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Sipariş no, müşteri, ürün ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Orders List */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {filteredOrders.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            {searchQuery || statusFilter !== "all" ? "Filtrelemeye uygun sipariş bulunamadı." : "Sipariş bulunmuyor."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Sipariş No</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Müşteri</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Ürün</th>
                  {!isWorker && <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Miktar</th>}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Kaynak</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Hazırlık</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Durum</th>
                  {showFinance && <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Fiyat</th>}
                  {(isManager || canClose) && activeTab === "active" && (
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">İşlem</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredOrders.map((order) => {
                  const readyPercent = getReadyPercent(order);
                  const isReady = readyPercent >= 95;

                  return (
                    <tr key={order.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-semibold text-blue-600">{order.order_no}</span>
                      </td>
                      <td className="px-4 py-3 text-sm">{order.customer}</td>
                      <td className="px-4 py-3 text-sm">
                        {order.product_type}
                        {order.micron && order.width && (
                          <span className="text-xs text-slate-500 ml-1">
                            {order.micron}μ {order.width}mm
                          </span>
                        )}
                      </td>
                      {!isWorker && (
                        <td className="px-4 py-3 text-sm">
                          {order.quantity} {order.unit}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span className="text-lg" title={SOURCE_TYPE_ICONS[order.source_type]}>
                          {SOURCE_TYPE_ICONS[order.source_type]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="w-32">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className={isReady ? "text-green-600 font-medium" : "text-slate-600"}>
                              {Math.round(readyPercent)}%
                            </span>
                            <span className="text-slate-500">
                              {order.stock_ready_kg || 0}+{order.production_ready_kg || 0} / {order.quantity}
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${isReady ? "bg-green-500" : "bg-blue-500"}`}
                              style={{ width: `${readyPercent}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={getStatusColor(order.status)}>
                          {ORDER_STATUS_LABELS[order.status]}
                        </Badge>
                      </td>
                      {showFinance && (
                        <td className="px-4 py-3 text-sm">
                          {order.price ? (
                            <span>
                              {order.price.toLocaleString("tr-TR")} {order.currency}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      )}
                      {(isManager || canClose) && activeTab === "active" && (
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {isManager && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setTaskDialogOrder(order)}
                              >
                                Görev
                              </Button>
                            )}
                            {canClose && order.status !== "closed" && order.status !== "cancelled" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50"
                                onClick={() => closeOrder(order)}
                              >
                                Evrak Kes
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Order Form Dialog */}
      <OrderForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSuccess={loadOrders}
        editOrder={editOrder}
        showFinance={showFinance}
      />

      {/* Task Assign Dialog */}
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
