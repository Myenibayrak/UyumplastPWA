"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { CuttingPlan, Order, StockItem, Profile, AppRole } from "@/lib/types";
import { CUTTING_PLAN_STATUS_LABELS } from "@/lib/types";
import { canManageProductionPlans, canViewStock, resolveRoleByIdentity } from "@/lib/rbac";
import { toast } from "@/hooks/use-toast";
import { Plus, PlayCircle, CheckCircle } from "lucide-react";

export default function ProductionPage() {
  const [plans, setPlans] = useState<CuttingPlan[]>([]);
  const [role, setRole] = useState<AppRole | null>(null);
  const [fullName, setFullName] = useState("");
  const [planOpen, setPlanOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [operators, setOperators] = useState<Profile[]>([]);

  const [planForm, setPlanForm] = useState({
    order_id: "",
    source_stock_id: "",
    assigned_to: "",
    target_width: "",
    target_kg: "",
    notes: "",
  });
  const hasStockAccess = canViewStock(role, fullName);
  const canManagePlanStatus = canManageProductionPlans(role);
  const canCreatePlan = canManagePlanStatus && hasStockAccess;

  const loadPlans = useCallback(async () => {
    const res = await fetch("/api/cutting-plans", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setPlans(data as CuttingPlan[]);
    }
  }, []);

  useEffect(() => {
      const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role, full_name").eq("id", user.id).single();
      if (profile) {
        const resolved = resolveRoleByIdentity(profile.role as AppRole, profile.full_name || "");
        if (resolved) setRole(resolved);
        setFullName(profile.full_name || "");
      }
    });
    supabase.from("profiles").select("*").in("role", ["production"]).then(({ data }) => {
      if (data) setOperators(data as Profile[]);
    });
    loadPlans();
  }, [loadPlans]);

  async function handleOpenPlanDialog() {
    if (!canCreatePlan) {
      toast({
        title: "Plan oluşturma yetkisi yok",
        description: "Plan oluşturmak için üretim/admin rolü ve stok erişimi gerekir.",
        variant: "destructive",
      });
      return;
    }

    // Load orders and stock
    const orderRes = await fetch("/api/orders", { cache: "no-store" });
    if (orderRes.ok) {
      const all: Order[] = await orderRes.json();
      setOrders(
        all.filter(
          (o) =>
            (o.source_type === "production" || o.source_type === "both")
            && !["closed", "cancelled", "shipped", "delivered"].includes(o.status)
        )
      );
    }

    const stockRes = await fetch("/api/stock?category=film", { cache: "no-store" });
    if (stockRes.ok) {
      setStockItems(await stockRes.json());
    } else {
      toast({ title: "Stok listesi yüklenemedi", variant: "destructive" });
      return;
    }

    setPlanOpen(true);
  }

  async function handleCreatePlan() {
    if (!planForm.order_id || !planForm.source_stock_id) {
      toast({ title: "Lütfen sipariş ve kaynak bobin seçin", variant: "destructive" });
      return;
    }

    setPlanLoading(true);
    try {
      const stock = stockItems.find((s) => s.id === planForm.source_stock_id);
      const res = await fetch("/api/cutting-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: planForm.order_id,
          source_stock_id: planForm.source_stock_id,
          source_product: stock?.product || "",
          source_micron: stock?.micron,
          source_width: stock?.width,
          source_kg: stock?.kg,
          target_width: planForm.target_width ? Number(planForm.target_width) : null,
          target_kg: planForm.target_kg ? Number(planForm.target_kg) : null,
          assigned_to: planForm.assigned_to || null,
          notes: planForm.notes || null,
        }),
      });

      if (!res.ok) throw new Error((await res.json()).error || "Hata");

      toast({ title: "Kesim planı oluşturuldu" });
      setPlanOpen(false);
      setPlanForm({ order_id: "", source_stock_id: "", assigned_to: "", target_width: "", target_kg: "", notes: "" });
      await loadPlans();
    } catch (err) {
      toast({ title: "Hata", description: err instanceof Error ? err.message : "Bilinmeyen", variant: "destructive" });
    } finally {
      setPlanLoading(false);
    }
  }

  async function handleStatusChange(planId: string, status: string) {
    if (!canManagePlanStatus) {
      toast({ title: "Durum güncelleme yetkisi yok", variant: "destructive" });
      return;
    }

    const res = await fetch(`/api/cutting-plans/${planId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    if (res.ok) {
      toast({ title: "Durum güncellendi" });
      await loadPlans();
    } else {
      toast({ title: "Hata", variant: "destructive" });
    }
  }

  const selectedStock = stockItems.find((s) => s.id === planForm.source_stock_id);

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Üretim Planları</h1>
          <p className="text-sm text-slate-500">Kesim planlarını oluşturun ve yönetin</p>
        </div>
        <Button onClick={handleOpenPlanDialog} size="sm" disabled={!canCreatePlan}>
          <Plus className="h-4 w-4 mr-2" />
          Plan Oluştur
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Planlı</p>
          <p className="text-2xl font-bold text-slate-600">{plans.filter((p) => p.status === "planned").length}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Kesimde</p>
          <p className="text-2xl font-bold text-yellow-600">{plans.filter((p) => p.status === "in_progress").length}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Tamamlandı</p>
          <p className="text-2xl font-bold text-green-600">{plans.filter((p) => p.status === "completed").length}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Toplam</p>
          <p className="text-2xl font-bold text-slate-900">{plans.length}</p>
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {plans.map((plan) => {
          const order = plan.order as Order;
          const assignee = plan.assignee as Profile | null;

          return (
            <div key={plan.id} className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-mono text-sm font-semibold text-blue-600">{order?.order_no}</h3>
                  <p className="text-sm text-slate-600">{order?.customer}</p>
                </div>
                <Badge className={getStatusColor(plan.status)}>
                  {CUTTING_PLAN_STATUS_LABELS[plan.status]}
                </Badge>
              </div>

              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-slate-500">Kaynak:</p>
                    <p className="font-medium">
                      {plan.source_product} {plan.source_micron}µ {plan.source_width}mm — {plan.source_kg} kg
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Hedef:</p>
                    <p className="font-medium">
                      {plan.target_width}mm — {plan.target_kg} kg
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-slate-500">Ürün:</p>
                  <p className="font-medium">{order?.product_type}</p>
                </div>
                <div>
                  <p className="text-slate-500">Operatör:</p>
                  <p className="font-medium">{assignee?.full_name || "Atanmadı"}</p>
                </div>
                {plan.notes && (
                  <div>
                    <p className="text-slate-500">Notlar:</p>
                    <p className="text-slate-700">{plan.notes}</p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="mt-4 pt-4 border-t border-slate-200 flex gap-2">
                {canManagePlanStatus && plan.status === "planned" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStatusChange(plan.id, "in_progress")}
                  >
                    <PlayCircle className="h-3 w-3 mr-1" />
                    Başlat
                  </Button>
                )}
                {canManagePlanStatus && plan.status === "in_progress" && (
                  <Button
                    size="sm"
                    onClick={() => handleStatusChange(plan.id, "completed")}
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Tamamla
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {plans.length === 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-500">
          Kesim planı bulunmuyor. Yeni plan oluşturun.
        </div>
      )}

      {/* Plan Dialog */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni Kesim Planı</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Order Selection */}
            <div>
              <Label>Sipariş *</Label>
              <Select value={planForm.order_id} onValueChange={(v) => setPlanForm((p) => ({ ...p, order_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Sipariş seçin" /></SelectTrigger>
                <SelectContent>
                  {orders.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.order_no} — {o.customer} ({o.product_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Source Stock Selection */}
            <div>
              <Label>Kaynak Bobin *</Label>
              <Select value={planForm.source_stock_id} onValueChange={(v) => setPlanForm((p) => ({ ...p, source_stock_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Stok kartı seçin" /></SelectTrigger>
                <SelectContent>
                  {stockItems.filter((s) => s.kg > 0).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.product} {s.micron}µ {s.width}mm — {s.kg} kg
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedStock && (
                <p className="text-xs text-slate-500 mt-1">
                  {selectedStock.product} {selectedStock.micron}µ {selectedStock.width}mm — {selectedStock.kg} kg
                </p>
              )}
            </div>

            {/* Target Width & KG */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Hedef En (mm)</Label>
                <Input
                  type="number"
                  value={planForm.target_width}
                  onChange={(e) => setPlanForm((p) => ({ ...p, target_width: e.target.value }))}
                  placeholder="130"
                />
              </div>
              <div>
                <Label>Hedef Kg</Label>
                <Input
                  type="number"
                  value={planForm.target_kg}
                  onChange={(e) => setPlanForm((p) => ({ ...p, target_kg: e.target.value }))}
                  placeholder="900"
                />
              </div>
            </div>

            {/* Operator */}
            <div>
              <Label>Operatör</Label>
              <Select value={planForm.assigned_to || "__all__"} onValueChange={(v) => setPlanForm((p) => ({ ...p, assigned_to: v === "__all__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Seçin (opsiyonel)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Herkese (departman)</SelectItem>
                  {operators.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div>
              <Label>Notlar</Label>
              <Textarea
                value={planForm.notes}
                onChange={(e) => setPlanForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Opsiyonel notlar..."
                rows={2}
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPlanOpen(false)}>
                İptal
              </Button>
              <Button onClick={handleCreatePlan} disabled={planLoading}>
                {planLoading ? "Oluşturuluyor..." : "Oluştur"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    planned: "bg-slate-100 text-slate-700",
    in_progress: "bg-yellow-100 text-yellow-800",
    completed: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-700",
  };
  return colors[status] || "bg-slate-100 text-slate-700";
}
