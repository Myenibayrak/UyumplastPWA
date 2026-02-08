"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Order, OrderStockEntry } from "@/lib/types";
import { ORDER_STATUS_LABELS, SOURCE_TYPE_ICONS } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import { Search, Plus, Trash2 } from "lucide-react";

export default function WarehouseEntryPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [entries, setEntries] = useState<OrderStockEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form fields (manuel - mavi)
  const [bobbinLabel, setBobbinLabel] = useState("");
  const [kg, setKg] = useState("");
  const [notes, setNotes] = useState("");

  const loadOrders = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("orders")
      .select("*")
      .in("status", ["draft", "confirmed", "in_production"])
      .order("created_at", { ascending: false });

    if (data) setOrders(data as Order[]);
  }, []);

  const loadEntries = useCallback(async (orderId: string) => {
    const res = await fetch(`/api/order-stock-entries?order_id=${encodeURIComponent(orderId)}`);
    if (res.ok) {
      const data = await res.json();
      setEntries(data as OrderStockEntry[]);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (selectedOrder) {
      loadEntries(selectedOrder.id);
    }
  }, [selectedOrder, loadEntries]);

  useEffect(() => {
    if (!selectedOrder) return;
    const refreshed = orders.find((o) => o.id === selectedOrder.id);
    if (!refreshed) {
      setSelectedOrder(null);
      setEntries([]);
      return;
    }
    if (refreshed !== selectedOrder) {
      setSelectedOrder(refreshed);
    }
  }, [orders, selectedOrder]);

  async function handleSubmit() {
    if (!selectedOrder || !bobbinLabel || !kg) {
      toast({ title: "Hata", description: "Lütfen sipariş, bobin etiketi ve kg girin.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/order-stock-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: selectedOrder.id,
          bobbin_label: bobbinLabel,
          kg: Number(kg),
          notes: notes || null,
        }),
      });

      if (!res.ok) throw new Error((await res.json()).error || "Kayıt hatası");

      toast({ title: "Stok girişi kaydedildi" });

      // Reset and close
      setBobbinLabel("");
      setKg("");
      setNotes("");
      setEntryDialogOpen(false);

      // Reload
      await loadEntries(selectedOrder.id);
      await loadOrders();
    } catch (err) {
      toast({ title: "Hata", description: err instanceof Error ? err.message : "Bilinmeyen hata", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteEntry(entryId: string) {
    try {
      const res = await fetch(`/api/order-stock-entries/${entryId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Silme hatası");
      toast({ title: "Giriş silindi" });
      await loadEntries(selectedOrder?.id || "");
      await loadOrders();
    } catch {
      toast({ title: "Hata", variant: "destructive" });
    }
  }

  function getReadyPercent(order: Order): number {
    const qty = Number(order.quantity || 0);
    if (qty <= 0) return 0;
    const totalReady = Number(order.stock_ready_kg || 0) + Number(order.production_ready_kg || 0);
    return Math.min(100, (totalReady / qty) * 100);
  }

  // Filter orders
  const filteredOrders = orders.filter((o) => {
    if (o.source_type === "production") return false; // Only stock or both
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

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Depo Girişi</h1>
        <p className="text-sm text-slate-500">Siparişlere stok girişi yapın</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Sipariş no, müşteri, ürün ara..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Orders List */}
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-700">Hazırlık Bekleyen Siparişler</h2>
        </div>
        <div className="divide-y divide-slate-200">
          {filteredOrders.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">
              {searchQuery ? "Sipariş bulunamadı." : "Hazırlık bekleyen sipariş yok."}
            </p>
          ) : (
            filteredOrders.map((order) => {
              const readyPercent = getReadyPercent(order);
              const isReady = readyPercent >= 95;
              const totalReady = Number(order.stock_ready_kg || 0) + Number(order.production_ready_kg || 0);
              const totalNeeded = Math.max(0, Number(order.quantity || 0) - totalReady);

              return (
                <div
                  key={order.id}
                  className="p-4 hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => setSelectedOrder(order)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-lg" title={SOURCE_TYPE_ICONS[order.source_type]}>
                        {SOURCE_TYPE_ICONS[order.source_type]}
                      </span>
                      <span className="font-mono text-sm font-semibold text-blue-600">{order.order_no}</span>
                      <span className="text-sm">{order.customer}</span>
                      <span className="text-xs text-slate-500">{order.product_type}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">
                        {totalReady} / {order.quantity} kg
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Depo: {order.stock_ready_kg || 0} | Üretim: {order.production_ready_kg || 0}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 mr-4">
                      <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div className={`h-full ${isReady ? "bg-green-500" : "bg-blue-500"}`} style={{ width: `${readyPercent}%` }} />
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium">{totalNeeded > 0 ? `${totalNeeded} kg gerekli` : "Hazır!"}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Selected Order Detail */}
      {selectedOrder && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold">{selectedOrder.order_no}</h2>
              <p className="text-sm text-slate-600">
                {selectedOrder.customer} - {selectedOrder.product_type}
              </p>
            </div>
            <Button onClick={() => setEntryDialogOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Giriş Ekle
            </Button>
          </div>

          {/* Entries */}
          <div className="space-y-2">
            {entries.length === 0 ? (
              <p className="text-center text-sm text-slate-500 py-4">Henüz giriş yapılmamış.</p>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium">{entry.bobbin_label}</p>
                    <p className="text-xs text-slate-500">
                      {entry.kg} kg
                      {entry.notes && ` - ${entry.notes}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-slate-500">
                      {new Date(entry.entered_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-700"
                      onClick={() => handleDeleteEntry(entry.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Summary */}
          <div className="mt-4 pt-4 border-t border-slate-200 flex justify-between text-sm">
            <span className="text-slate-600">Toplam Giriş:</span>
            <span className="font-medium">
              {entries.reduce((sum, e) => sum + e.kg, 0)} kg
            </span>
          </div>
        </div>
      )}

      {/* Entry Dialog */}
      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Stok Girişi — {selectedOrder?.order_no}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Manuel Giriş - Mavi */}
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-xs font-medium text-blue-800 mb-3">Giriş Bilgileri</p>
              <div className="space-y-3">
                <div>
                  <Label>Bobin Etiketi</Label>
                  <Input
                    value={bobbinLabel}
                    onChange={(e) => setBobbinLabel(e.target.value)}
                    placeholder="STK-2026-001"
                  />
                </div>
                <div>
                  <Label>Miktar (kg)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={kg}
                    onChange={(e) => setKg(e.target.value)}
                    placeholder="25.5"
                  />
                </div>
                <div>
                  <Label>Notlar</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Opsiyonel notlar..."
                    rows={2}
                  />
                </div>
              </div>
            </div>

            {/* Otomatik - Gri */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-xs font-medium text-slate-600 mb-2">Sipariş Bilgisi</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-slate-500">Müşteri</p>
                  <p className="font-medium">{selectedOrder?.customer}</p>
                </div>
                <div>
                  <p className="text-slate-500">Ürün</p>
                  <p className="font-medium">{selectedOrder?.product_type}</p>
                </div>
                <div>
                  <p className="text-slate-500">Mevcut Hazır (Toplam)</p>
                  <p className="font-medium">
                    {(Number(selectedOrder?.stock_ready_kg || 0) + Number(selectedOrder?.production_ready_kg || 0))} kg
                  </p>
                  <p className="text-xs text-slate-500">
                    Depo: {selectedOrder?.stock_ready_kg || 0} | Üretim: {selectedOrder?.production_ready_kg || 0}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Kalan İhtiyaç</p>
                  <p className="font-medium">
                    {Math.max(0, Number(selectedOrder?.quantity || 0) - (Number(selectedOrder?.stock_ready_kg || 0) + Number(selectedOrder?.production_ready_kg || 0)))} kg
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEntryDialogOpen(false)}>
                İptal
              </Button>
              <Button onClick={handleSubmit} disabled={loading}>
                {loading ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
