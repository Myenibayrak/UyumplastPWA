"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ProductionBobin, Order, CuttingPlan, AppRole } from "@/lib/types";
import { isProductionReadyStatus } from "@/lib/production-ready";
import { canUseBobinEntry, resolveRoleByIdentity } from "@/lib/rbac";
import { toast } from "@/hooks/use-toast";
import { CheckCircle, Clock, Package } from "lucide-react";

type CuttingPlanWithMetrics = CuttingPlan & {
  produced_bobins?: { kg: number; status: string }[];
};

export default function BobinEntryPage() {
  const [activePlans, setActivePlans] = useState<CuttingPlanWithMetrics[]>([]);
  const [role, setRole] = useState<AppRole | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<CuttingPlanWithMetrics | null>(null);
  const [todayBobins, setTodayBobins] = useState<ProductionBobin[]>([]);
  const [loading, setLoading] = useState(false);
  const canUsePage = canUseBobinEntry(role);

  // Form fields (manuel - sarı)
  const [bobbinNo, setBobbinNo] = useState("");
  const [meter, setMeter] = useState("");
  const [kg, setKg] = useState("");
  const [fireKg, setFireKg] = useState("");
  const [notes, setNotes] = useState("");

  // Load cutting plans and today's bobins
  const loadData = useCallback(async () => {
    if (!canUsePage) {
      setActivePlans([]);
      setTodayBobins([]);
      return;
    }

    const supabase = createClient();

    // Load active cutting plans
    const { data: plans } = await supabase
      .from("cutting_plans")
      .select(`
        *,
        order:orders!inner(order_no, customer, product_type, micron, width, quantity, unit),
        produced_bobins:production_bobins(kg, status)
      `)
      .in("status", ["planned", "in_progress"])
      .order("created_at", { ascending: false });

    if (plans) setActivePlans(plans as CuttingPlanWithMetrics[]);

    // Load today's bobins
    const today = new Date().toISOString().split("T")[0];
    const { data: bobins } = await supabase
      .from("production_bobins")
      .select("*")
      .gte("entered_at", today)
      .order("entered_at", { ascending: false });

    if (bobins) setTodayBobins(bobins as ProductionBobin[]);
  }, [canUsePage]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setProfileLoaded(true);
        return;
      }
      const { data: profile } = await supabase.from("profiles").select("role, full_name").eq("id", user.id).single();
      if (profile) {
        const resolved = resolveRoleByIdentity(profile.role as AppRole, profile.full_name || "");
        if (resolved) setRole(resolved);
      }
      setProfileLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (profileLoaded && canUsePage) loadData();
  }, [profileLoaded, canUsePage, loadData]);

  // Auto-generate bobbin number
  useEffect(() => {
    if (!bobbinNo) {
      const today = new Date();
      const dateStr = today.toISOString().split("T")[0].replace(/-/g, "");
      const count = todayBobins.filter((b) => b.bobbin_no.startsWith(`BOB-${dateStr}`)).length;
      setBobbinNo(`BOB-${dateStr}-${String(count + 1).padStart(3, "0")}`);
    }
  }, [bobbinNo, todayBobins]);

  async function handleSubmit() {
    if (!canUsePage) {
      toast({ title: "Yetkiniz yok", variant: "destructive" });
      return;
    }
    if (!selectedPlan || !bobbinNo || !meter || !kg) {
      toast({ title: "Hata", description: "Lütfen plan, bobin no, metre ve kilo girin.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/production-bobins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: selectedPlan.order_id,
          cutting_plan_id: selectedPlan.id,
          bobbin_no: bobbinNo,
          meter: Number(meter),
          kg: Number(kg),
          fire_kg: fireKg ? Number(fireKg) : 0,
          notes: notes || null,
        }),
      });

      if (!res.ok) throw new Error((await res.json()).error || "Kayıt hatası");

      toast({ title: "Bobin kaydedildi" });

      // Reset form
      setBobbinNo("");
      setMeter("");
      setKg("");
      setFireKg("");
      setNotes("");

      // Reload data
      await loadData();
    } catch (err) {
      toast({ title: "Hata", description: err instanceof Error ? err.message : "Bilinmeyen hata", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function getReadyPercent(order: Order): number {
    const qty = Number(order.quantity || 0);
    if (qty <= 0) return 0;
    const totalReady = Number(order.stock_ready_kg || 0) + Number(order.production_ready_kg || 0);
    return Math.min(100, (totalReady / qty) * 100);
  }

  function getPlanProducedKg(plan: CuttingPlanWithMetrics): number {
    return (plan.produced_bobins ?? [])
      .filter((b) => isProductionReadyStatus(b.status))
      .reduce((sum, b) => sum + Number(b.kg || 0), 0);
  }

  if (!profileLoaded) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-lg border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-500">Yükleniyor...</p>
      </div>
    );
  }

  if (!canUsePage) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-lg border border-slate-200 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">Bobin Girişi Yetkisi Yok</h1>
        <p className="text-sm text-slate-600">Bu ekran sadece Üretim ve Yönetici rolleri için açıktır.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Bobin Girişi</h1>
        <p className="text-sm text-slate-500">Üretim çıktı bobinlerini girin</p>
      </div>

      {/* Active Plans */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Aktif Kesim Planları</h2>
        <div className="space-y-2">
          {activePlans.length === 0 ? (
            <p className="text-sm text-slate-500">Aktif plan bulunmuyor.</p>
          ) : (
            activePlans.map((plan) => {
              const order = plan.order as Order;
              const orderReadyPercent = getReadyPercent(order);
              const planProducedKg = getPlanProducedKg(plan);
              const planTargetKg = Number(plan.target_kg || 0);
              const planProgress = planTargetKg > 0 ? Math.min(100, (planProducedKg / planTargetKg) * 100) : 0;
              const planRemaining = Math.max(0, planTargetKg - planProducedKg);
              const isSelected = selectedPlan?.id === plan.id;

              return (
                <div
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    isSelected ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-sm font-semibold">{order.order_no}</p>
                      <p className="text-xs text-slate-600">{order.customer} - {order.product_type}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">
                        {plan.source_product} {plan.source_micron}μ {plan.source_width}mm → {plan.target_width}mm
                      </p>
                      <p className="text-xs text-slate-500">
                        Plan: {planProducedKg.toFixed(1)} / {planTargetKg.toFixed(1)} kg | Kalan: {planRemaining.toFixed(1)} kg
                      </p>
                      <p className="text-xs text-slate-500">
                        Sipariş Hazır: {orderReadyPercent.toFixed(0)}%
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="bg-blue-500 h-full" style={{ width: `${planProgress}%` }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Entry Form */}
      {selectedPlan && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Bobin Bilgileri</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Manuel Giriş - Sarı */}
            <div className="col-span-2 space-y-3">
              <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                <p className="text-xs font-medium text-yellow-800 mb-2">Bobin Bilgileri (Manuel Giriş)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Bobin No</Label>
                    <Input value={bobbinNo} onChange={(e) => setBobbinNo(e.target.value)} placeholder="BOB-..." />
                  </div>
                  <div>
                    <Label>Metre</Label>
                    <Input type="number" value={meter} onChange={(e) => setMeter(e.target.value)} placeholder="2500" />
                  </div>
                  <div>
                    <Label>Kilo</Label>
                    <Input type="number" step="0.1" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="20.5" />
                  </div>
                  <div>
                    <Label>Fire (kg)</Label>
                    <Input type="number" step="0.1" value={fireKg} onChange={(e) => setFireKg(e.target.value)} placeholder="0.5" />
                  </div>
                </div>
                <div className="mt-3">
                  <Label>Notlar</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opsiyonel notlar..." rows={2} />
                </div>
              </div>
            </div>

            {/* Otomatik - Gri */}
            <div className="col-span-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-xs font-medium text-slate-600 mb-2">Sipariş Bilgisi (Otomatik)</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-slate-500">Sipariş No</p>
                  <p className="font-medium">{(selectedPlan.order as Order).order_no}</p>
                </div>
                <div>
                  <p className="text-slate-500">Müşteri</p>
                  <p className="font-medium">{(selectedPlan.order as Order).customer}</p>
                </div>
                <div>
                  <p className="text-slate-500">Ürün</p>
                  <p className="font-medium">{(selectedPlan.order as Order).product_type}</p>
                </div>
                <div>
                  <p className="text-slate-500">Hedef En</p>
                  <p className="font-medium">{selectedPlan.target_width} mm</p>
                </div>
                <div>
                  <p className="text-slate-500">Hedef Miktar</p>
                  <p className="font-medium">{selectedPlan.target_kg} kg</p>
                </div>
                <div>
                  <p className="text-slate-500">Durum</p>
                  <p className="font-medium">{selectedPlan.status === "planned" ? "Planlı" : "Kesimde"}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button onClick={handleSubmit} disabled={loading} className="min-w-32">
              {loading ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </div>
        </div>
      )}

      {/* Today's Bobins */}
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-700">Bugünün Bobinleri</h2>
        </div>
        <div className="divide-y divide-slate-200">
          {todayBobins.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">Bugün henüz bobin girilmedi.</p>
          ) : (
            todayBobins.map((bobin) => (
              <div key={bobin.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-full ${
                    bobin.status === "produced" ? "bg-green-100" :
                    bobin.status === "warehouse" ? "bg-blue-100" :
                    "bg-slate-100"
                  }`}>
                    {bobin.status === "produced" ? <CheckCircle className="h-4 w-4 text-green-600" /> :
                     bobin.status === "warehouse" ? <Package className="h-4 w-4 text-blue-600" /> :
                     <Clock className="h-4 w-4 text-slate-500" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{bobin.bobbin_no}</p>
                    <p className="text-xs text-slate-500">
                      {bobin.meter}m | {bobin.kg}kg | Fire: {bobin.fire_kg}kg
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">
                    {new Date(bobin.entered_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
