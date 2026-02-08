"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CuttingPlan, CuttingPlanStatus, AppRole, Order, StockItem, Profile } from "@/lib/types";
import { CUTTING_PLAN_STATUS_LABELS } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import { Factory, Scissors, Plus, CheckCircle, PlayCircle, Package } from "lucide-react";

const planStatusBg: Record<string, string> = {
  planned: "bg-gray-100 text-gray-700 border-gray-300",
  in_progress: "bg-blue-100 text-blue-700 border-blue-300",
  completed: "bg-green-100 text-green-700 border-green-300",
  cancelled: "bg-red-100 text-red-700 border-red-300",
};

export default function ProductionPage() {
  const [plans, setPlans] = useState<CuttingPlan[]>([]);
  const [role, setRole] = useState<AppRole | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [orders, setOrders] = useState<Order[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [operators, setOperators] = useState<Profile[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);

  // Plan creation dialog
  const [planOpen, setPlanOpen] = useState(false);
  const [planForm, setPlanForm] = useState({
    order_id: "", source_stock_id: "", assigned_to: "",
    target_width: "", target_kg: "", target_quantity: "1", notes: "",
  });
  const [planLoading, setPlanLoading] = useState(false);

  // Cutting entry dialog
  const [cutOpen, setCutOpen] = useState(false);
  const [cutPlan, setCutPlan] = useState<CuttingPlan | null>(null);
  const [cutForm, setCutForm] = useState({
    bobbin_label: "", cut_width: "", cut_kg: "", cut_quantity: "1",
    is_order_piece: true, notes: "",
  });
  const [cutLoading, setCutLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (profile) setRole(profile.role as AppRole);
    });
    supabase.from("profiles").select("*").in("role", ["production"]).eq("active", true).then(({ data }) => {
      if (data) setOperators(data as Profile[]);
    });
  }, []);

  const loadPlans = useCallback(async () => {
    const url = `/api/cutting-plans?status=${statusFilter}`;
    const res = await fetch(url);
    if (res.ok) setPlans(await res.json());
  }, [statusFilter]);

  const loadPendingOrders = useCallback(async () => {
    const res = await fetch("/api/orders");
    if (res.ok) {
      const all: Order[] = await res.json();
      const productionOrders = all.filter((o) => o.source_type === "production" && !["shipped", "delivered", "cancelled"].includes(o.status));
      // Plans already loaded - filter out orders that already have a cutting plan
      const planOrderIds = new Set(plans.map((p) => p.order_id));
      setPendingOrders(productionOrders.filter((o) => !planOrderIds.has(o.id)));
    }
  }, [plans]);

  useEffect(() => { loadPlans(); }, [loadPlans]);
  useEffect(() => { loadPendingOrders(); }, [loadPendingOrders]);

  const loadOrdersForPlan = async () => {
    const res = await fetch("/api/orders");
    if (res.ok) {
      const all: Order[] = await res.json();
      setOrders(all.filter((o) => ["confirmed", "draft", "in_production"].includes(o.status)));
    }
  };

  const loadStockForPlan = async () => {
    const res = await fetch("/api/stock?category=film");
    if (res.ok) setStockItems(await res.json());
  };

  const selectedStock = stockItems.find((s) => s.id === planForm.source_stock_id);

  async function handleCreatePlan() {
    if (!planForm.order_id || !planForm.source_stock_id) {
      toast({ title: "Hata", description: "Sipariş ve kaynak bobin seçin", variant: "destructive" });
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
          target_quantity: Number(planForm.target_quantity) || 1,
          assigned_to: planForm.assigned_to || null,
          notes: planForm.notes || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Hata");
      toast({ title: "Kesim planı oluşturuldu" });
      setPlanOpen(false);
      setPlanForm({ order_id: "", source_stock_id: "", assigned_to: "", target_width: "", target_kg: "", target_quantity: "1", notes: "" });
      loadPlans();
    } catch (err: unknown) {
      toast({ title: "Hata", description: err instanceof Error ? err.message : "Bilinmeyen", variant: "destructive" });
    } finally { setPlanLoading(false); }
  }

  async function handleCutEntry() {
    if (!cutPlan || !cutForm.bobbin_label || !cutForm.cut_kg) {
      toast({ title: "Hata", description: "Etiket ve kg zorunlu", variant: "destructive" });
      return;
    }
    setCutLoading(true);
    try {
      const res = await fetch("/api/cutting-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cutting_plan_id: cutPlan.id,
          bobbin_label: cutForm.bobbin_label,
          cut_width: Number(cutForm.cut_width) || cutPlan.target_width || 0,
          cut_kg: Number(cutForm.cut_kg),
          cut_quantity: Number(cutForm.cut_quantity) || 1,
          is_order_piece: cutForm.is_order_piece,
          notes: cutForm.notes || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Hata");
      toast({ title: "Kesim kaydedildi" });
      setCutForm({ bobbin_label: "", cut_width: "", cut_kg: "", cut_quantity: "1", is_order_piece: true, notes: "" });
      loadPlans();
    } catch (err: unknown) {
      toast({ title: "Hata", description: err instanceof Error ? err.message : "Bilinmeyen", variant: "destructive" });
    } finally { setCutLoading(false); }
  }

  async function handleStatusChange(planId: string, status: CuttingPlanStatus) {
    const res = await fetch(`/api/cutting-plans/${planId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) { toast({ title: `Durum güncellendi: ${CUTTING_PLAN_STATUS_LABELS[status]}` }); loadPlans(); }
    else toast({ title: "Hata", variant: "destructive" });
  }

  const isManager = role === "admin" || (role === "production" && userId === operators.find((o) => o.full_name === "Esat")?.id);
  const isOperator = role === "production";
  const isAdmin = role === "admin";

  const myPlans = isAdmin ? plans : plans.filter((p) =>
    isManager ? true : p.assigned_to === userId
  );

  const plannedCount = myPlans.filter((p) => p.status === "planned").length;
  const inProgressCount = myPlans.filter((p) => p.status === "in_progress").length;
  const completedCount = myPlans.filter((p) => p.status === "completed").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Factory className="h-5 w-5 text-orange-600" />
        <h1 className="text-xl font-bold">Üretim</h1>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Planlar</SelectItem>
            <SelectItem value="planned">Planlandı</SelectItem>
            <SelectItem value="in_progress">Kesimde</SelectItem>
            <SelectItem value="completed">Tamamlandı</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-2 text-xs">
          <Badge variant="outline" className="bg-gray-50">Bekleyen: {plannedCount}</Badge>
          <Badge variant="outline" className="bg-blue-50">Kesimde: {inProgressCount}</Badge>
          <Badge variant="outline" className="bg-green-50">Tamam: {completedCount}</Badge>
        </div>
        <div className="flex-1" />
        {(isManager || isAdmin) && (
          <Button size="sm" className="h-8" onClick={() => { setPlanOpen(true); loadOrdersForPlan(); loadStockForPlan(); }}>
            <Plus className="h-3 w-3 mr-1" /> Kesim Planı
          </Button>
        )}
      </div>

      {/* Planlama Bekleyenler - only for managers/admin */}
      {(isManager || isAdmin) && pendingOrders.length > 0 && (
        <div className="rounded-lg border-2 border-orange-300 bg-orange-50 p-4 space-y-3">
          <h2 className="text-sm font-bold text-orange-700 flex items-center gap-2">
            <Factory className="h-4 w-4" />
            Üretim Planlama Bekleyenler ({pendingOrders.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {pendingOrders.map((o) => (
              <div key={o.id} className="bg-white rounded-md border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-blue-700 font-bold">{o.order_no}</span>
                  <Badge variant="outline" className="text-[10px] bg-orange-100 text-orange-700 border-orange-300">Planlama Bekliyor</Badge>
                </div>
                <p className="text-xs"><strong>{o.customer}</strong></p>
                <p className="text-xs text-muted-foreground">
                  {o.product_type} {o.micron ? `${o.micron}µ` : ""} {o.width ? `${o.width}mm` : ""} — {o.quantity} {o.unit}
                  {o.trim_width ? ` (Kesim: ${o.trim_width}mm)` : ""}
                </p>
                {o.ship_date && <p className="text-[10px] text-red-600">Sevk: {new Date(o.ship_date).toLocaleDateString("tr-TR")}</p>}
                <Button size="sm" className="h-7 w-full mt-1 text-xs bg-orange-600 hover:bg-orange-700"
                  onClick={() => {
                    setPlanForm((prev) => ({ ...prev, order_id: o.id }));
                    setPlanOpen(true);
                    loadOrdersForPlan();
                    loadStockForPlan();
                  }}>
                  <Scissors className="h-3 w-3 mr-1" /> Kesim Planla
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {myPlans.length === 0 && pendingOrders.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-lg text-muted-foreground">
            {isManager || isAdmin ? "Henüz kesim planı yok. Siparişler için kesim planı oluşturun." : "Size atanmış kesim planı yok."}
          </p>
        </div>
      ) : myPlans.length === 0 ? null : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {myPlans.map((plan) => {
            const order = plan.order as Record<string, unknown> | undefined;
            const assignee = plan.assignee as Record<string, unknown> | null | undefined;
            const entries = (plan.entries || []) as { id: string; bobbin_label: string; cut_kg: number; cut_width: number; cut_quantity: number; is_order_piece: boolean; created_at: string }[];
            const totalCutKg = entries.filter((e) => e.is_order_piece).reduce((s, e) => s + e.cut_kg, 0);
            const leftoverKg = entries.filter((e) => !e.is_order_piece).reduce((s, e) => s + e.cut_kg, 0);

            return (
              <Card key={plan.id} className={`border-2 ${planStatusBg[plan.status] || ""}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="font-mono text-blue-700">{order?.order_no as string}</span>
                      <span className="text-sm font-normal text-muted-foreground">{order?.customer as string}</span>
                    </CardTitle>
                    <Badge className={`text-[10px] ${planStatusBg[plan.status]}`}>
                      {CUTTING_PLAN_STATUS_LABELS[plan.status]}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div>Ürün: <strong>{order?.product_type as string}</strong> {order?.micron ? `${order.micron}µ` : ""} {order?.width ? `${order.width}mm` : ""} — İstenen: {order?.quantity as number} {order?.unit as string}</div>
                    <div>Kaynak: <strong>{plan.source_product}</strong> {plan.source_micron ? `${plan.source_micron}µ` : ""} {plan.source_width ? `${plan.source_width}mm` : ""} {plan.source_kg ? `(${plan.source_kg} kg)` : ""}</div>
                    {plan.target_width && <div>Hedef Kesim: {plan.target_width}mm {plan.target_kg ? `× ${plan.target_kg} kg` : ""} × {plan.target_quantity} adet</div>}
                    {assignee && <div>Operatör: <strong>{assignee.full_name as string}</strong></div>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {entries.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-gray-600">Kesim Kayıtları:</p>
                      <div className="rounded border bg-white overflow-auto max-h-40">
                        <table className="w-full text-[11px]">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-2 py-1 text-left">Etiket</th>
                              <th className="px-2 py-1 text-right">En</th>
                              <th className="px-2 py-1 text-right">Kg</th>
                              <th className="px-2 py-1 text-right">Adet</th>
                              <th className="px-2 py-1 text-left">Tip</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map((e) => (
                              <tr key={e.id} className="border-t">
                                <td className="px-2 py-1 font-mono">{e.bobbin_label}</td>
                                <td className="px-2 py-1 text-right">{e.cut_width}</td>
                                <td className="px-2 py-1 text-right font-semibold">{e.cut_kg}</td>
                                <td className="px-2 py-1 text-right">{e.cut_quantity}</td>
                                <td className="px-2 py-1">
                                  {e.is_order_piece
                                    ? <span className="text-blue-600">Sipariş</span>
                                    : <span className="text-orange-600">Depo</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex gap-3 text-xs">
                        <span className="text-blue-700 font-semibold">Sipariş: {totalCutKg.toLocaleString("tr-TR")} kg</span>
                        {leftoverKg > 0 && <span className="text-orange-600 font-semibold">Depo: {leftoverKg.toLocaleString("tr-TR")} kg</span>}
                      </div>
                    </div>
                  )}

                  {plan.notes && <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">{plan.notes}</p>}

                  <div className="flex gap-2 flex-wrap">
                    {plan.status === "planned" && isOperator && (
                      <Button size="sm" className="h-8 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => handleStatusChange(plan.id, "in_progress")}>
                        <PlayCircle className="h-3 w-3 mr-1" /> Kesime Başla
                      </Button>
                    )}
                    {(plan.status === "planned" || plan.status === "in_progress") && (isOperator || isAdmin) && (
                      <Button size="sm" variant="outline" className="h-8" onClick={() => { setCutPlan(plan); setCutOpen(true); }}>
                        <Scissors className="h-3 w-3 mr-1" /> Kesim Gir
                      </Button>
                    )}
                    {plan.status === "in_progress" && (isOperator || isAdmin) && (
                      <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700 text-white" onClick={() => handleStatusChange(plan.id, "completed")}>
                        <CheckCircle className="h-3 w-3 mr-1" /> Tamamla
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Plan Dialog */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Yeni Kesim Planı</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Sipariş *</Label>
              <Select value={planForm.order_id} onValueChange={(v) => setPlanForm((p) => ({ ...p, order_id: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sipariş seçin" /></SelectTrigger>
                <SelectContent>
                  {orders.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.order_no} — {o.customer} ({o.product_type} {o.micron ? `${o.micron}µ` : ""} {o.width ? `${o.width}mm` : ""} {o.quantity} {o.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Kaynak Bobin (Stok) *</Label>
              <Select value={planForm.source_stock_id} onValueChange={(v) => setPlanForm((p) => ({ ...p, source_stock_id: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Büyük bobin seçin" /></SelectTrigger>
                <SelectContent>
                  {stockItems.filter((s) => s.kg > 0).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.product} {s.micron ? `${s.micron}µ` : ""} {s.width ? `${s.width}mm` : ""} — {s.kg.toLocaleString("tr-TR")} kg ({s.quantity} adet)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedStock && (
                <p className="text-[10px] text-muted-foreground">Seçili: {selectedStock.product} {selectedStock.micron}µ {selectedStock.width}mm — {selectedStock.kg} kg</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Hedef En (mm)</Label>
                <Input className="h-8 text-xs" type="number" value={planForm.target_width} onChange={(e) => setPlanForm((p) => ({ ...p, target_width: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hedef Kg</Label>
                <Input className="h-8 text-xs" type="number" value={planForm.target_kg} onChange={(e) => setPlanForm((p) => ({ ...p, target_kg: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Adet</Label>
                <Input className="h-8 text-xs" type="number" value={planForm.target_quantity} onChange={(e) => setPlanForm((p) => ({ ...p, target_quantity: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Operatör</Label>
              <Select value={planForm.assigned_to || "__none__"} onValueChange={(v) => setPlanForm((p) => ({ ...p, assigned_to: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Operatör seçin" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Atama yapma</SelectItem>
                  {operators.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Notlar</Label>
              <Textarea className="text-xs min-h-[60px]" value={planForm.notes} onChange={(e) => setPlanForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Kesim notları..." />
            </div>

            <Button className="w-full" onClick={handleCreatePlan} disabled={planLoading}>
              {planLoading ? "Oluşturuluyor..." : "Kesim Planı Oluştur"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cut Entry Dialog */}
      <Dialog open={cutOpen} onOpenChange={(v) => { if (!v) { setCutOpen(false); setCutPlan(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scissors className="h-4 w-4" />
              Kesim Girişi
              {cutPlan && <span className="text-sm font-normal text-muted-foreground">— {cutPlan.source_product} {cutPlan.source_width}mm</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Bobin Etiketi *</Label>
              <Input className="h-10 text-sm font-mono" value={cutForm.bobbin_label} onChange={(e) => setCutForm((p) => ({ ...p, bobbin_label: e.target.value }))} placeholder="BOB-001" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Kesim Eni (mm)</Label>
                <Input className="h-10 text-sm" type="number" value={cutForm.cut_width} onChange={(e) => setCutForm((p) => ({ ...p, cut_width: e.target.value }))}
                  placeholder={cutPlan?.target_width ? String(cutPlan.target_width) : ""} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Kg *</Label>
                <Input className="h-10 text-sm font-bold" type="number" step="0.01" value={cutForm.cut_kg} onChange={(e) => setCutForm((p) => ({ ...p, cut_kg: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Adet</Label>
                <Input className="h-10 text-sm" type="number" value={cutForm.cut_quantity} onChange={(e) => setCutForm((p) => ({ ...p, cut_quantity: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tip</Label>
              <Select value={cutForm.is_order_piece ? "order" : "stock"} onValueChange={(v) => setCutForm((p) => ({ ...p, is_order_piece: v === "order" }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="order"><Package className="inline h-3 w-3 mr-1" />Sipariş İçin</SelectItem>
                  <SelectItem value="stock"><Package className="inline h-3 w-3 mr-1" />Depo (Kalan)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Not</Label>
              <Input className="h-8 text-xs" value={cutForm.notes} onChange={(e) => setCutForm((p) => ({ ...p, notes: e.target.value }))} placeholder="İsteğe bağlı..." />
            </div>
            <Button className="w-full h-12 text-lg font-bold" onClick={handleCutEntry} disabled={cutLoading}>
              {cutLoading ? "Kaydediliyor..." : "Kesimi Kaydet"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
