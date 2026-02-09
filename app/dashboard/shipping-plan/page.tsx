"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AppRole, Order, ShippingSchedule } from "@/lib/types";
import { SHIPPING_SCHEDULE_STATUS_LABELS } from "@/lib/types";
import { canCompleteShipping, canManageShippingSchedule, canViewShippingSchedule, resolveRoleByIdentity } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { CalendarClock, CheckCircle2, Plus, RefreshCcw, Undo2 } from "lucide-react";

function dateIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function ShippingPlanPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [fullName, setFullName] = useState("");
  const [schedules, setSchedules] = useState<ShippingSchedule[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(dateIso(0));
  const [showHistory, setShowHistory] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    order_id: "",
    scheduled_date: dateIso(0),
    scheduled_time: "",
    sequence_no: "1",
    notes: "",
  });

  const canView = canViewShippingSchedule(role, fullName);
  const canManage = canManageShippingSchedule(role, fullName);
  const canComplete = canCompleteShipping(role, fullName);

  const loadSchedules = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const from = showHistory ? dateIso(-7) : selectedDate;
      const to = showHistory ? dateIso(7) : selectedDate;
      const res = await fetch(`/api/shipping-schedules?date_from=${from}&date_to=${to}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Sevkiyat planı yüklenemedi");
      const data = await res.json();
      setSchedules(Array.isArray(data) ? data : []);
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [canView, selectedDate, showHistory]);

  const loadOrders = useCallback(async () => {
    if (!canManage) return;
    const res = await fetch("/api/orders", { cache: "no-store" });
    if (!res.ok) return;
    const data: Order[] = await res.json();
    setOrders(data.filter((o) => !["closed", "cancelled", "delivered"].includes(o.status)));
  }, [canManage]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", user.id)
        .single();
      if (profile) {
        const resolved = resolveRoleByIdentity(profile.role as AppRole, profile.full_name || "");
        if (resolved) setRole(resolved);
        setFullName(profile.full_name || "");
      }
    });
  }, []);

  useEffect(() => {
    if (role) loadSchedules();
  }, [role, loadSchedules]);

  useEffect(() => {
    if (role) loadOrders();
  }, [role, loadOrders]);

  const grouped = useMemo(() => {
    const map = new Map<string, ShippingSchedule[]>();
    for (const s of schedules) {
      const list = map.get(s.scheduled_date) ?? [];
      list.push(s);
      map.set(s.scheduled_date, list);
    }
    map.forEach((list, key) => {
      list.sort((a: ShippingSchedule, b: ShippingSchedule) => {
        if (a.sequence_no !== b.sequence_no) return a.sequence_no - b.sequence_no;
        return String(a.scheduled_time || "").localeCompare(String(b.scheduled_time || ""));
      });
      map.set(key, list);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [schedules]);

  async function createPlan() {
    if (!canManage) return;
    if (!form.order_id) {
      toast({ title: "Sipariş seçin", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/shipping-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: form.order_id,
          scheduled_date: form.scheduled_date,
          scheduled_time: form.scheduled_time || null,
          sequence_no: Number(form.sequence_no || 1),
          notes: form.notes || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Plan oluşturulamadı");
      toast({ title: "Sevkiyat planına eklendi" });
      setCreateOpen(false);
      setForm({ order_id: "", scheduled_date: selectedDate, scheduled_time: "", sequence_no: "1", notes: "" });
      await loadSchedules();
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function patchPlan(id: string, payload: Record<string, unknown>, successText: string) {
    try {
      const res = await fetch(`/api/shipping-schedules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Güncelleme hatası");
      toast({ title: successText });
      await loadSchedules();
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" });
    }
  }

  if (role && !canView) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-lg border border-slate-200 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">Sevkiyat Programı Yetkisi Yok</h1>
        <p className="text-sm text-slate-600">Bu ekran sevkiyat, satış, yönetici ve fabrika müdürü için açıktır.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sevkiyat Programı</h1>
          <p className="text-sm text-slate-500">Saat ve sıra bazlı planlama, gecikenlerin otomatik ertesi güne devri.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Sadece Seçili Gün" : "Geçmişi Göster"}
          </Button>
          {canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Plan Ekle
            </Button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-3 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Tarih</Label>
          <Input type="date" className="h-9" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={() => setSelectedDate(dateIso(0))}>Bugün</Button>
        <Button variant="outline" size="sm" className="h-9" onClick={() => setSelectedDate(dateIso(1))}>Yarın</Button>
        <Button variant="outline" size="sm" className="h-9" onClick={loadSchedules}>
          <RefreshCcw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Yenile
        </Button>
      </div>

      <div className="space-y-4">
        {grouped.length === 0 ? (
          <div className="bg-white border rounded-lg p-10 text-center text-slate-500">Plan kaydı bulunamadı.</div>
        ) : (
          grouped.map(([date, list]) => (
            <div key={date} className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-700">{new Date(`${date}T00:00:00`).toLocaleDateString("tr-TR")}</h2>
              <div className="grid grid-cols-1 gap-2">
                {list.map((item) => (
                  <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{item.order?.order_no} - {item.order?.customer}</p>
                        <p className="text-xs text-slate-500">{item.order?.product_type} | {item.order?.quantity} {item.order?.unit}</p>
                        <p className="text-xs text-slate-500">Sipariş Termin: {item.order?.ship_date ? new Date(item.order.ship_date).toLocaleDateString("tr-TR") : "—"}</p>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs">
                          <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5">
                            <CalendarClock className="h-3 w-3 mr-1" /> {item.scheduled_time || "--:--"}
                          </span>
                          <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5">Sıra #{item.sequence_no}</span>
                          <span className={`inline-flex items-center rounded px-2 py-0.5 ${item.status === "completed" ? "bg-emerald-100 text-emerald-800" : item.status === "cancelled" ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"}`}>
                            {SHIPPING_SCHEDULE_STATUS_LABELS[item.status]}
                          </span>
                          {item.carry_count > 0 && (
                            <span className="inline-flex items-center rounded bg-amber-100 text-amber-800 px-2 py-0.5">
                              Ertelendi: {item.carry_count}
                            </span>
                          )}
                        </div>
                        {item.notes && <p className="mt-2 text-xs text-slate-600">{item.notes}</p>}
                      </div>
                      <div className="flex flex-col gap-1">
                        {item.status === "planned" && canComplete && (
                          <Button size="sm" className="h-8 text-xs" onClick={() => patchPlan(item.id, { status: "completed" }, "Sevkiyat tamamlandı")}>
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Tamamla
                          </Button>
                        )}
                        {item.status === "planned" && canManage && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            onClick={() => patchPlan(item.id, { scheduled_date: dateIso(1) }, "Plan ertesi güne aktarıldı")}
                          >
                            <Undo2 className="h-3 w-3 mr-1" /> Ertele
                          </Button>
                        )}
                        {canManage && item.status !== "cancelled" && (
                          <Button size="sm" variant="outline" className="h-8 text-xs text-red-600" onClick={() => patchPlan(item.id, { status: "cancelled" }, "Plan iptal edildi")}>
                            İptal
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni Sevkiyat Planı</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Sipariş</Label>
              <Select value={form.order_id || "__none__"} onValueChange={(v) => setForm((p) => ({ ...p, order_id: v === "__none__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Sipariş seçin" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Seçin</SelectItem>
                  {orders.map((order) => (
                    <SelectItem key={order.id} value={order.id}>
                      {order.order_no} - {order.customer}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Tarih</Label>
                <Input type="date" value={form.scheduled_date} onChange={(e) => setForm((p) => ({ ...p, scheduled_date: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Saat</Label>
                <Input type="time" value={form.scheduled_time} onChange={(e) => setForm((p) => ({ ...p, scheduled_time: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Sıra</Label>
                <Input type="number" min={1} value={form.sequence_no} onChange={(e) => setForm((p) => ({ ...p, sequence_no: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Not</Label>
              <Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Opsiyonel not..." />
            </div>
            <Button className="w-full" onClick={createPlan} disabled={saving}>{saving ? "Kaydediliyor..." : "Kaydet"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
