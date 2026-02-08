"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CuttingPlan, CuttingPlanStatus, CuttingEntry, CuttingSpec, AppRole, Order, StockItem, Profile } from "@/lib/types";
import { CUTTING_PLAN_STATUS_LABELS } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import { Factory, Scissors, Plus, CheckCircle, PlayCircle, Trash2 } from "lucide-react";

const statusColors: Record<string, string> = {
  planned: "bg-gray-200",
  in_progress: "bg-yellow-200",
  completed: "bg-green-200",
  cancelled: "bg-red-200",
};

export default function ProductionPage() {
  const [activeTab, setActiveTab] = useState<"program" | "kesim">("program");
  const [plans, setPlans] = useState<CuttingPlan[]>([]);
  const [role, setRole] = useState<AppRole | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [orders, setOrders] = useState<Order[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [operators, setOperators] = useState<Profile[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);

  // Plan dialog
  const [planOpen, setPlanOpen] = useState(false);
  const [planForm, setPlanForm] = useState({
    order_id: "", source_stock_id: "", assigned_to: "",
    target_width: "", target_kg: "", target_quantity: "1", notes: "",
  });
  const [specRows, setSpecRows] = useState<{ en: string; bant: string; cap: string; firma: string; kg: string }[]>([{ en: "", bant: "", cap: "", firma: "", kg: "" }]);
  const [planLoading, setPlanLoading] = useState(false);

  // Cut entry dialog
  const [cutOpen, setCutOpen] = useState(false);
  const [cutPlan, setCutPlan] = useState<CuttingPlan | null>(null);
  const [cutForm, setCutForm] = useState({
    bobbin_label: "", cut_width: "", cut_kg: "", cut_quantity: "1",
    is_order_piece: true, notes: "", machine_no: "", firma: "", cap: "", bant: "",
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
    supabase.from("profiles").select("*").in("role", ["production"]).then(({ data }) => {
      if (data) setOperators(data as Profile[]);
    });
  }, []);

  const loadPlans = useCallback(async () => {
    const res = await fetch(`/api/cutting-plans?status=${statusFilter}`);
    if (res.ok) setPlans(await res.json());
  }, [statusFilter]);

  const loadPendingOrders = useCallback(async () => {
    const res = await fetch("/api/orders");
    if (res.ok) {
      const all: Order[] = await res.json();
      const prodOrders = all.filter((o) => o.source_type === "production" && !["shipped", "delivered", "cancelled"].includes(o.status));
      const planOrderIds = new Set(plans.map((p) => p.order_id));
      setPendingOrders(prodOrders.filter((o) => !planOrderIds.has(o.id)));
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
      toast({ title: "Sipariş ve kaynak bobin seçin", variant: "destructive" }); return;
    }
    setPlanLoading(true);
    try {
      const stock = stockItems.find((s) => s.id === planForm.source_stock_id);
      const cutting_spec = specRows.filter((r) => r.en).map((r) => ({
        en: Number(r.en), bant: r.bant || undefined, cap: r.cap || undefined, firma: r.firma || undefined, kg: r.kg ? Number(r.kg) : undefined,
      }));
      const res = await fetch("/api/cutting-plans", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: planForm.order_id, source_stock_id: planForm.source_stock_id,
          source_product: stock?.product || "", source_micron: stock?.micron,
          source_width: stock?.width, source_kg: stock?.kg,
          target_width: planForm.target_width ? Number(planForm.target_width) : null,
          target_kg: planForm.target_kg ? Number(planForm.target_kg) : null,
          target_quantity: Number(planForm.target_quantity) || 1,
          assigned_to: planForm.assigned_to || null, notes: planForm.notes || null,
          cutting_spec,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Hata");
      toast({ title: "Kesim planı oluşturuldu" });
      setPlanOpen(false);
      setPlanForm({ order_id: "", source_stock_id: "", assigned_to: "", target_width: "", target_kg: "", target_quantity: "1", notes: "" });
      setSpecRows([{ en: "", bant: "", cap: "", firma: "", kg: "" }]);
      loadPlans();
    } catch (err: unknown) {
      toast({ title: "Hata", description: err instanceof Error ? err.message : "Bilinmeyen", variant: "destructive" });
    } finally { setPlanLoading(false); }
  }

  async function handleCutEntry() {
    if (!cutPlan || !cutForm.bobbin_label || !cutForm.cut_kg) {
      toast({ title: "Etiket ve kg zorunlu", variant: "destructive" }); return;
    }
    setCutLoading(true);
    try {
      const res = await fetch("/api/cutting-entries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cutting_plan_id: cutPlan.id, bobbin_label: cutForm.bobbin_label,
          cut_width: Number(cutForm.cut_width) || cutPlan.target_width || 0,
          cut_kg: Number(cutForm.cut_kg), cut_quantity: Number(cutForm.cut_quantity) || 1,
          is_order_piece: cutForm.is_order_piece, notes: cutForm.notes || null,
          machine_no: cutForm.machine_no || null, firma: cutForm.firma || null,
          cap: cutForm.cap || null, bant: cutForm.bant || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Hata");
      toast({ title: "Kesim kaydedildi" });
      setCutForm({ bobbin_label: "", cut_width: "", cut_kg: "", cut_quantity: "1", is_order_piece: true, notes: "", machine_no: cutForm.machine_no, firma: "", cap: "", bant: "" });
      loadPlans();
    } catch (err: unknown) {
      toast({ title: "Hata", description: err instanceof Error ? err.message : "Bilinmeyen", variant: "destructive" });
    } finally { setCutLoading(false); }
  }

  async function handleStatusChange(planId: string, status: CuttingPlanStatus) {
    const res = await fetch(`/api/cutting-plans/${planId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (res.ok) { toast({ title: CUTTING_PLAN_STATUS_LABELS[status] }); loadPlans(); }
    else toast({ title: "Hata", variant: "destructive" });
  }

  const isManager = role === "admin" || (role === "production" && userId === operators.find((o) => o.full_name === "Esat")?.id);
  const isOperator = role === "production";
  const isAdmin = role === "admin";

  const myPlans = isAdmin ? plans : plans.filter((p) => isManager ? true : p.assigned_to === userId);

  // Flatten all entries from all plans for Kesim Girişi tab
  const allEntries = useMemo(() => {
    const entries: (CuttingEntry & { plan?: CuttingPlan })[] = [];
    for (const plan of plans) {
      for (const entry of (plan.entries || [])) {
        entries.push({ ...(entry as CuttingEntry), plan });
      }
    }
    return entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [plans]);

  const plannedCount = myPlans.filter((p) => p.status === "planned").length;
  const inProgressCount = myPlans.filter((p) => p.status === "in_progress").length;
  const completedCount = myPlans.filter((p) => p.status === "completed").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Factory className="h-5 w-5 text-orange-600" />
        <h1 className="text-xl font-bold">Üretim</h1>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "program" | "kesim")}>
          <TabsList>
            <TabsTrigger value="program">Üretim Programı</TabsTrigger>
            <TabsTrigger value="kesim">Kesim Girişi</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex gap-2 text-xs">
          <Badge variant="outline" className="bg-gray-50">Bekleyen: {plannedCount}</Badge>
          <Badge variant="outline" className="bg-yellow-50">Kesimde: {inProgressCount}</Badge>
          <Badge variant="outline" className="bg-green-50">Tamam: {completedCount}</Badge>
        </div>
        <div className="flex-1" />
        {activeTab === "program" && (isManager || isAdmin) && (
          <Button size="sm" className="h-8" onClick={() => { setPlanOpen(true); loadOrdersForPlan(); loadStockForPlan(); }}>
            <Plus className="h-3 w-3 mr-1" /> Kesim Planı
          </Button>
        )}
      </div>

      {/* ====================== TAB 1: ÜRETİM PROGRAMI ====================== */}
      {activeTab === "program" && (
        <>
          {/* Planlama Bekleyenler */}
          {(isManager || isAdmin) && pendingOrders.length > 0 && (
            <div className="rounded border-2 border-orange-300 bg-orange-50 p-3">
              <h2 className="text-xs font-bold text-orange-700 mb-2">⏳ Planlama Bekleyenler ({pendingOrders.length})</h2>
              <div className="flex gap-2 flex-wrap">
                {pendingOrders.map((o) => (
                  <button key={o.id} className="bg-white border rounded px-3 py-2 text-left hover:bg-orange-100 transition-colors"
                    onClick={() => { setPlanForm((prev) => ({ ...prev, order_id: o.id })); setPlanOpen(true); loadOrdersForPlan(); loadStockForPlan(); }}>
                    <span className="font-mono text-xs text-blue-700 font-bold">{o.order_no}</span>
                    <span className="text-[10px] text-gray-600 ml-1">{o.customer} — {o.product_type} {o.width ? `${o.width}mm` : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Program Tablosu - Excel Image 1 gibi */}
          <div className="rounded-lg border bg-white shadow-sm overflow-auto max-h-[calc(100vh-200px)]">
            <table className="w-full text-[11px] border-collapse">
              <thead className="bg-green-100 sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 text-left border-r font-bold bg-green-200" rowSpan={2}>SİP</th>
                  <th className="px-2 py-2 text-left border-r font-bold bg-green-200" rowSpan={2}>dur</th>
                  <th className="px-2 py-2 text-right border-r" rowSpan={2}>Kesilen</th>
                  <th className="px-2 py-2 text-center border-r bg-yellow-100" colSpan={5}>KESİLECEK BOBİNLER</th>
                  <th className="px-2 py-2 text-center border-r bg-cyan-100" colSpan={4}>KESİM ÖLÇÜLERİ</th>
                  <th className="px-2 py-2 text-left border-r" rowSpan={2}>Operatör</th>
                  <th className="px-2 py-2 text-center" rowSpan={2}>İşlem</th>
                </tr>
                <tr>
                  <th className="px-1 py-1 text-left border-r bg-yellow-50">CİNSİ</th>
                  <th className="px-1 py-1 text-right border-r bg-yellow-50">Mik</th>
                  <th className="px-1 py-1 text-right border-r bg-yellow-50">EN</th>
                  <th className="px-1 py-1 text-right border-r bg-yellow-50">Bo</th>
                  <th className="px-1 py-1 text-right border-r bg-yellow-50">KG</th>
                  <th className="px-1 py-1 text-right border-r bg-cyan-50">EN-1</th>
                  <th className="px-1 py-1 text-left border-r bg-cyan-50">Firma</th>
                  <th className="px-1 py-1 text-right border-r bg-cyan-50">EN-2</th>
                  <th className="px-1 py-1 text-left bg-cyan-50">Firma</th>
                </tr>
              </thead>
              <tbody>
                {myPlans.length === 0 ? (
                  <tr><td colSpan={14} className="px-4 py-12 text-center text-muted-foreground">Kesim planı yok</td></tr>
                ) : myPlans.map((plan) => {
                  const o = plan.order as Record<string, unknown> | undefined;
                  const assignee = plan.assignee as Record<string, unknown> | null | undefined;
                  const entries = (plan.entries || []) as CuttingEntry[];
                  const totalCutKg = entries.filter((e) => e.is_order_piece).reduce((s, e) => s + e.cut_kg, 0);
                  const spec = (plan.cutting_spec || []) as CuttingSpec[];

                  return (
                    <tr key={plan.id} className={`border-b hover:bg-blue-50/50 ${statusColors[plan.status] || ""}`}>
                      <td className="px-2 py-1.5 border-r font-mono font-bold text-blue-800">{o?.order_no as string}</td>
                      <td className="px-2 py-1.5 border-r">
                        <span className={`inline-block w-2 h-2 rounded-full mr-1 ${plan.status === "completed" ? "bg-green-500" : plan.status === "in_progress" ? "bg-yellow-500" : "bg-gray-400"}`} />
                        {CUTTING_PLAN_STATUS_LABELS[plan.status]}
                      </td>
                      <td className="px-2 py-1.5 border-r text-right font-semibold text-green-700">{totalCutKg > 0 ? totalCutKg : ""}</td>
                      <td className="px-1 py-1.5 border-r font-medium">{plan.source_product}</td>
                      <td className="px-1 py-1.5 border-r text-right">{plan.source_micron ?? ""}</td>
                      <td className="px-1 py-1.5 border-r text-right font-semibold">{plan.source_width ?? ""}</td>
                      <td className="px-1 py-1.5 border-r text-right">{plan.target_quantity}</td>
                      <td className="px-1 py-1.5 border-r text-right font-bold">{plan.source_kg ?? ""}</td>
                      <td className="px-1 py-1.5 border-r text-right text-cyan-700">{spec[0]?.en ?? plan.target_width ?? ""}</td>
                      <td className="px-1 py-1.5 border-r">{spec[0]?.firma ?? (o?.customer as string) ?? ""}</td>
                      <td className="px-1 py-1.5 border-r text-right text-cyan-700">{spec[1]?.en ?? ""}</td>
                      <td className="px-1 py-1.5 border-r">{spec[1]?.firma ?? ""}</td>
                      <td className="px-1 py-1.5 border-r text-xs">{assignee?.full_name as string ?? "—"}</td>
                      <td className="px-1 py-1.5 text-center">
                        <div className="flex gap-1 justify-center">
                          {plan.status === "planned" && (isOperator || isAdmin) && (
                            <Button size="sm" className="h-6 text-[10px] px-2 bg-blue-600" onClick={() => handleStatusChange(plan.id, "in_progress")}>
                              <PlayCircle className="h-3 w-3" />
                            </Button>
                          )}
                          {(plan.status === "planned" || plan.status === "in_progress") && (isOperator || isAdmin) && (
                            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => { setCutPlan(plan); setCutOpen(true); }}>
                              <Scissors className="h-3 w-3" />
                            </Button>
                          )}
                          {plan.status === "in_progress" && (isOperator || isAdmin) && (
                            <Button size="sm" className="h-6 text-[10px] px-2 bg-green-600" onClick={() => handleStatusChange(plan.id, "completed")}>
                              <CheckCircle className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ====================== TAB 2: KESİM GİRİŞİ ====================== */}
      {activeTab === "kesim" && (
        <div className="rounded-lg border bg-white shadow-sm overflow-auto max-h-[calc(100vh-200px)]">
          <table className="w-full text-[11px] border-collapse">
            <thead className="bg-gray-100 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-left border-r font-bold">#</th>
                <th className="px-2 py-2 text-left border-r">Sip No</th>
                <th className="px-2 py-2 text-left border-r">Tarih</th>
                <th className="px-2 py-2 text-left border-r bg-green-50">Operatör</th>
                <th className="px-2 py-2 text-left border-r bg-green-50">Makine</th>
                <th className="px-2 py-2 text-left border-r bg-yellow-50">CİNSİ</th>
                <th className="px-2 py-2 text-right border-r bg-yellow-50">Mik</th>
                <th className="px-2 py-2 text-right border-r bg-yellow-50">EN</th>
                <th className="px-2 py-2 text-left border-r">Etiket</th>
                <th className="px-2 py-2 text-right border-r bg-cyan-50 font-bold">KG</th>
                <th className="px-2 py-2 text-right border-r bg-cyan-50">Adet</th>
                <th className="px-2 py-2 text-left border-r">Firma</th>
                <th className="px-2 py-2 text-left border-r">ÇAP</th>
                <th className="px-2 py-2 text-left">Tip</th>
              </tr>
            </thead>
            <tbody>
              {allEntries.length === 0 ? (
                <tr><td colSpan={14} className="px-4 py-12 text-center text-muted-foreground">Henüz kesim girişi yok</td></tr>
              ) : allEntries.map((entry, i) => {
                const plan = entry.plan;
                const o = plan?.order as Record<string, unknown> | undefined;
                const assignee = plan?.assignee as Record<string, unknown> | null | undefined;
                return (
                  <tr key={entry.id} className={`border-b hover:bg-blue-50/50 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/30"}`}>
                    <td className="px-2 py-1.5 border-r text-gray-400">{i + 1}</td>
                    <td className="px-2 py-1.5 border-r font-mono font-bold text-blue-800">{o?.order_no as string ?? ""}</td>
                    <td className="px-2 py-1.5 border-r">{new Date(entry.created_at).toLocaleDateString("tr-TR")}</td>
                    <td className="px-2 py-1.5 border-r bg-green-50/50 font-medium">{assignee?.full_name as string ?? "—"}</td>
                    <td className="px-2 py-1.5 border-r bg-green-50/50">{entry.machine_no ?? "—"}</td>
                    <td className="px-2 py-1.5 border-r bg-yellow-50/30">{plan?.source_product ?? ""}</td>
                    <td className="px-2 py-1.5 border-r bg-yellow-50/30 text-right">{plan?.source_micron ?? ""}</td>
                    <td className="px-2 py-1.5 border-r bg-yellow-50/30 text-right">{plan?.source_width ?? ""}</td>
                    <td className="px-2 py-1.5 border-r font-mono font-medium">{entry.bobbin_label}</td>
                    <td className="px-2 py-1.5 border-r bg-cyan-50/30 text-right font-bold text-red-700">{entry.cut_kg}</td>
                    <td className="px-2 py-1.5 border-r bg-cyan-50/30 text-right">{entry.cut_quantity}</td>
                    <td className="px-2 py-1.5 border-r">{entry.firma ?? (o?.customer as string) ?? ""}</td>
                    <td className="px-2 py-1.5 border-r">{entry.cap ?? ""}</td>
                    <td className="px-2 py-1.5">
                      {entry.is_order_piece
                        ? <span className="text-blue-600 font-medium">Sipariş</span>
                        : <span className="text-orange-600 font-medium">Depo</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ====================== Plan Dialog ====================== */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Yeni Kesim Planı</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Sipariş *</Label>
                <Select value={planForm.order_id} onValueChange={(v) => setPlanForm((p) => ({ ...p, order_id: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sipariş seçin" /></SelectTrigger>
                  <SelectContent>
                    {orders.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.order_no} — {o.customer} ({o.product_type} {o.width ? `${o.width}mm` : ""} {o.quantity} {o.unit})
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
                        {s.product} {s.micron ? `${s.micron}µ` : ""} {s.width ? `${s.width}mm` : ""} — {s.kg.toLocaleString("tr-TR")} kg
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedStock && <p className="text-[10px] text-muted-foreground">{selectedStock.product} {selectedStock.micron}µ {selectedStock.width}mm — {selectedStock.kg} kg</p>}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Bobin Adet</Label>
                <Input className="h-8 text-xs" type="number" value={planForm.target_quantity} onChange={(e) => setPlanForm((p) => ({ ...p, target_quantity: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hedef En (mm)</Label>
                <Input className="h-8 text-xs" type="number" value={planForm.target_width} onChange={(e) => setPlanForm((p) => ({ ...p, target_width: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hedef Kg</Label>
                <Input className="h-8 text-xs" type="number" value={planForm.target_kg} onChange={(e) => setPlanForm((p) => ({ ...p, target_kg: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Operatör</Label>
                <Select value={planForm.assigned_to || "__none__"} onValueChange={(v) => setPlanForm((p) => ({ ...p, assigned_to: v === "__none__" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {operators.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Kesim Ölçüleri - multi-row spec */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Kesim Ölçüleri</Label>
                <Button type="button" variant="outline" size="sm" className="h-6 text-[10px]"
                  onClick={() => setSpecRows((r) => [...r, { en: "", bant: "", cap: "", firma: "", kg: "" }])}>
                  <Plus className="h-3 w-3 mr-1" /> Satır
                </Button>
              </div>
              <div className="rounded border">
                <table className="w-full text-[11px]">
                  <thead className="bg-cyan-50">
                    <tr>
                      <th className="px-2 py-1 text-left">EN (mm)</th>
                      <th className="px-2 py-1 text-left">Bant</th>
                      <th className="px-2 py-1 text-left">ÇAP</th>
                      <th className="px-2 py-1 text-left">Firma</th>
                      <th className="px-2 py-1 text-left">KG</th>
                      <th className="px-2 py-1 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {specRows.map((row, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-1 py-0.5"><Input className="h-7 text-xs" type="number" value={row.en} onChange={(e) => { const n = [...specRows]; n[idx].en = e.target.value; setSpecRows(n); }} /></td>
                        <td className="px-1 py-0.5"><Input className="h-7 text-xs" value={row.bant} onChange={(e) => { const n = [...specRows]; n[idx].bant = e.target.value; setSpecRows(n); }} /></td>
                        <td className="px-1 py-0.5"><Input className="h-7 text-xs" value={row.cap} onChange={(e) => { const n = [...specRows]; n[idx].cap = e.target.value; setSpecRows(n); }} /></td>
                        <td className="px-1 py-0.5"><Input className="h-7 text-xs" value={row.firma} onChange={(e) => { const n = [...specRows]; n[idx].firma = e.target.value; setSpecRows(n); }} /></td>
                        <td className="px-1 py-0.5"><Input className="h-7 text-xs" type="number" value={row.kg} onChange={(e) => { const n = [...specRows]; n[idx].kg = e.target.value; setSpecRows(n); }} /></td>
                        <td className="px-1 py-0.5">
                          {specRows.length > 1 && <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSpecRows((r) => r.filter((_, i) => i !== idx))}><Trash2 className="h-3 w-3 text-red-500" /></Button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Notlar</Label>
              <Textarea className="text-xs min-h-[50px]" value={planForm.notes} onChange={(e) => setPlanForm((p) => ({ ...p, notes: e.target.value }))} placeholder="160x4+190+175+175 gibi kombinasyon notu..." />
            </div>
            <Button className="w-full" onClick={handleCreatePlan} disabled={planLoading}>
              {planLoading ? "Oluşturuluyor..." : "Kesim Planı Oluştur"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ====================== Cut Entry Dialog ====================== */}
      <Dialog open={cutOpen} onOpenChange={(v) => { if (!v) { setCutOpen(false); setCutPlan(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scissors className="h-4 w-4" /> Kesim Girişi
              {cutPlan && <span className="text-sm font-normal text-muted-foreground">— {cutPlan.source_product} {cutPlan.source_width}mm</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Bobin Etiketi *</Label>
                <Input className="h-10 text-sm font-mono font-bold" value={cutForm.bobbin_label} onChange={(e) => setCutForm((p) => ({ ...p, bobbin_label: e.target.value }))} placeholder="S100183" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Makine No</Label>
                <Input className="h-10 text-sm" value={cutForm.machine_no} onChange={(e) => setCutForm((p) => ({ ...p, machine_no: e.target.value }))} placeholder="4917" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Kesim Eni (mm)</Label>
                <Input className="h-10 text-sm" type="number" value={cutForm.cut_width} onChange={(e) => setCutForm((p) => ({ ...p, cut_width: e.target.value }))} placeholder={cutPlan?.target_width ? String(cutPlan.target_width) : ""} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold text-red-700">KG *</Label>
                <Input className="h-10 text-sm font-bold border-red-300" type="number" step="0.01" value={cutForm.cut_kg} onChange={(e) => setCutForm((p) => ({ ...p, cut_kg: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Adet</Label>
                <Input className="h-10 text-sm" type="number" value={cutForm.cut_quantity} onChange={(e) => setCutForm((p) => ({ ...p, cut_quantity: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Firma</Label>
                <Input className="h-8 text-xs" value={cutForm.firma} onChange={(e) => setCutForm((p) => ({ ...p, firma: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bant</Label>
                <Input className="h-8 text-xs" value={cutForm.bant} onChange={(e) => setCutForm((p) => ({ ...p, bant: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">ÇAP</Label>
                <Input className="h-8 text-xs" value={cutForm.cap} onChange={(e) => setCutForm((p) => ({ ...p, cap: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Tip</Label>
                <Select value={cutForm.is_order_piece ? "order" : "stock"} onValueChange={(v) => setCutForm((p) => ({ ...p, is_order_piece: v === "order" }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="order">Sipariş İçin</SelectItem>
                    <SelectItem value="stock">Depo (Kalan)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Not</Label>
                <Input className="h-8 text-xs" value={cutForm.notes} onChange={(e) => setCutForm((p) => ({ ...p, notes: e.target.value }))} />
              </div>
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
