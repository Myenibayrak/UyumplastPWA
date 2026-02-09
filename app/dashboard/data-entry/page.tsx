"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";
import { canViewDataEntryPanel, resolveRoleByIdentity } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { RefreshCcw } from "lucide-react";

type FeedRow = {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  created_at: string;
  actor?: { full_name?: string | null; role?: string | null } | null;
  row_data?: Record<string, unknown> | null;
};

type FeedResponse = {
  rows: FeedRow[];
  tables: string[];
  total: number;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("tr-TR");
}

function summarizeRow(row: FeedRow): string {
  const data = row.row_data ?? {};
  if (row.table_name === "order_stock_entries") {
    return `Bobin: ${String(data.bobbin_label || "—")} | Kg: ${String(data.kg || 0)} | Sipariş: ${String(data.order_id || "—")}`;
  }
  if (row.table_name === "production_bobins") {
    return `Bobin: ${String(data.bobbin_no || "—")} | Kg: ${String(data.kg || 0)} | Metre: ${String(data.meter || 0)} | Sipariş: ${String(data.order_id || "—")}`;
  }
  if (row.table_name === "cutting_entries") {
    return `Etiket: ${String(data.bobbin_label || "—")} | Kesim Kg: ${String(data.cut_kg || 0)} | Sipariş: ${String(data.order_id || "—")}`;
  }
  if (row.table_name === "stock_items") {
    return `Ürün: ${String(data.product || "—")} | Kategori: ${String(data.category || "—")} | Kg: ${String(data.kg || 0)} | Adet: ${String(data.quantity || 0)}`;
  }
  if (row.table_name === "stock_movements") {
    return `Hareket: ${String(data.movement_type || "—")} | Kg: ${String(data.kg || 0)} | Adet: ${String(data.quantity || 0)} | Sebep: ${String(data.reason || "—")}`;
  }
  if (row.table_name === "shipping_schedules") {
    return `Sipariş: ${String(data.order_id || "—")} | Tarih: ${String(data.scheduled_date || "—")} | Saat: ${String(data.scheduled_time || "—")} | Durum: ${String(data.status || "—")}`;
  }
  if (row.table_name === "orders") {
    return `Sipariş No: ${String(data.order_no || "—")} | Müşteri: ${String(data.customer || "—")} | Durum: ${String(data.status || "—")}`;
  }
  if (row.table_name === "order_tasks") {
    return `Sipariş: ${String(data.order_id || "—")} | Departman: ${String(data.department || "—")} | Durum: ${String(data.status || "—")}`;
  }
  return JSON.stringify(data).slice(0, 180);
}

export default function DataEntryPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [tableFilter, setTableFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("");
  const [sinceFilter, setSinceFilter] = useState("120");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      }
    });
  }, []);

  const load = useCallback(async () => {
    if (!canViewDataEntryPanel(role)) return;

    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams();
      q.set("mode", "entries");
      q.set("limit", "400");
      if (tableFilter !== "all") q.set("table", tableFilter);
      if (actionFilter !== "all") q.set("action", actionFilter);
      if (userFilter.trim()) q.set("user_id", userFilter.trim());
      if (sinceFilter !== "all") {
        const mins = Number(sinceFilter);
        if (Number.isFinite(mins) && mins > 0) {
          const since = new Date(Date.now() - mins * 60 * 1000).toISOString();
          q.set("since", since);
        }
      }

      const res = await fetch(`/api/data-entry-feed?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Veri akışı yüklenemedi");
      }

      const body = (await res.json()) as FeedResponse;
      setRows(Array.isArray(body.rows) ? body.rows : []);
      setTables(Array.isArray(body.tables) ? body.tables : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }, [role, tableFilter, actionFilter, userFilter, sinceFilter]);

  useEffect(() => {
    if (!role) return;
    void load();
  }, [role, load]);

  useEffect(() => {
    if (!canViewDataEntryPanel(role)) return;
    const timer = setInterval(() => {
      void load();
    }, 10000);
    return () => clearInterval(timer);
  }, [role, load]);

  const stats = useMemo(() => {
    const byTable = new Map<string, number>();
    for (const row of rows) {
      byTable.set(row.table_name, (byTable.get(row.table_name) || 0) + 1);
    }
    return Array.from(byTable.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [rows]);

  if (role && !canViewDataEntryPanel(role)) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-lg border border-slate-200 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">Canlı Veri Paneli Yetkisi Yok</h1>
        <p className="text-sm text-slate-600">Bu ekran yalnızca admin kullanıcılar içindir.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Canlı Veri Girişleri</h1>
          <p className="text-sm text-slate-500">Depo, üretim, sevkiyat ve tüm kritik işlemler satır bazında anlık izlenir.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCcw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Yenile
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border rounded-lg p-3">
          <p className="text-xs text-slate-500">Toplam Satır</p>
          <p className="text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        {stats.map(([table, count]) => (
          <div key={table} className="bg-white border rounded-lg p-3">
            <p className="text-xs text-slate-500 truncate">{table}</p>
            <p className="text-2xl font-bold text-blue-700">{count}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-white p-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Tablo</Label>
          <Select value={tableFilter} onValueChange={setTableFilter}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              {tables.map((table) => (
                <SelectItem key={table} value={table}>{table}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">İşlem</Label>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="INSERT">INSERT</SelectItem>
              <SelectItem value="UPDATE">UPDATE</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Süre</Label>
          <Select value={sinceFilter} onValueChange={setSinceFilter}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Son 30 dk</SelectItem>
              <SelectItem value="120">Son 2 saat</SelectItem>
              <SelectItem value="720">Son 12 saat</SelectItem>
              <SelectItem value="1440">Son 24 saat</SelectItem>
              <SelectItem value="all">Tüm zaman</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Kullanıcı ID</Label>
          <Input className="h-8 text-xs" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="UUID" />
        </div>

        <Button size="sm" className="h-8 text-xs" onClick={load} disabled={loading}>Uygula</Button>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="rounded-lg border bg-white overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-slate-500">Kayıt bulunamadı.</div>
        ) : (
          <div className="divide-y">
            {rows.map((row) => (
              <div key={row.id} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{row.table_name}</Badge>
                    <Badge className="text-[10px]">{row.action}</Badge>
                    <span className="text-xs text-slate-500">{formatDate(row.created_at)}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {row.actor?.full_name || row.user_id || "Sistem"}
                    {row.actor?.role ? ` (${row.actor.role})` : ""}
                  </p>
                </div>

                <p className="text-sm text-slate-700 break-words">{summarizeRow(row)}</p>

                <details>
                  <summary className="cursor-pointer text-xs text-slate-500">Satır Detayı</summary>
                  <pre className="mt-2 rounded bg-slate-50 p-2 text-[11px] overflow-auto">{JSON.stringify(row.row_data ?? {}, null, 2)}</pre>
                </details>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
