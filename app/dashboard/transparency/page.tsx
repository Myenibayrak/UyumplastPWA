"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AppRole } from "@/lib/types";
import { canViewAuditTrail, resolveRoleByIdentity } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/client";
import { RefreshCcw } from "lucide-react";

type AuditLogRow = {
  id: string;
  user_id: string;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  actor?: { full_name?: string | null; role?: AppRole | null } | null;
};

const ACTIONS = ["all", "INSERT", "UPDATE", "DELETE"] as const;

export default function TransparencyPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tableFilter, setTableFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState<(typeof ACTIONS)[number]>("all");
  const [userFilter, setUserFilter] = useState("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role, full_name").eq("id", user.id).single();
      if (profile) {
        const resolved = resolveRoleByIdentity(profile.role as AppRole, profile.full_name || "");
        if (resolved) setRole(resolved);
      }
    });
  }, []);

  const loadLogs = useCallback(async () => {
    if (!canViewAuditTrail(role)) return;
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams();
      q.set("limit", "300");
      if (tableFilter !== "all") q.set("table", tableFilter);
      if (actionFilter !== "all") q.set("action", actionFilter);
      if (userFilter.trim()) q.set("user_id", userFilter.trim());

      const res = await fetch(`/api/audit-logs?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Kayıtlar yüklenemedi");
      }
      const data: AuditLogRow[] = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }, [role, tableFilter, actionFilter, userFilter]);

  useEffect(() => {
    if (role) loadLogs();
  }, [role, loadLogs]);

  const tableOptions = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => set.add(l.table_name));
    return Array.from(set).sort();
  }, [logs]);

  const stats = useMemo(() => {
    return {
      total: logs.length,
      insert: logs.filter((l) => l.action === "INSERT").length,
      update: logs.filter((l) => l.action === "UPDATE").length,
      delete: logs.filter((l) => l.action === "DELETE").length,
    };
  }, [logs]);

  if (role && !canViewAuditTrail(role)) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-lg border border-slate-200 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">İşlem Geçmişi Yetkisi Yok</h1>
        <p className="text-sm text-slate-600">Bu ekran sadece yönetim rollerine açıktır.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">İşlem Geçmişi</h1>
          <p className="text-sm text-slate-500">Sistemde yapılan tüm kritik değişiklikler burada listelenir.</p>
        </div>
        <Button size="sm" variant="outline" onClick={loadLogs} disabled={loading}>
          <RefreshCcw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Yenile
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-slate-200 p-4"><p className="text-xs text-slate-500">Toplam</p><p className="text-2xl font-bold">{stats.total}</p></div>
        <div className="bg-white rounded-lg border border-slate-200 p-4"><p className="text-xs text-slate-500">Ekleme</p><p className="text-2xl font-bold text-green-700">{stats.insert}</p></div>
        <div className="bg-white rounded-lg border border-slate-200 p-4"><p className="text-xs text-slate-500">Güncelleme</p><p className="text-2xl font-bold text-blue-700">{stats.update}</p></div>
        <div className="bg-white rounded-lg border border-slate-200 p-4"><p className="text-xs text-slate-500">Silme</p><p className="text-2xl font-bold text-red-700">{stats.delete}</p></div>
      </div>

      <div className="rounded-lg border bg-white p-3 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Tablo</Label>
          <Select value={tableFilter} onValueChange={setTableFilter}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              {tableOptions.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">İşlem</Label>
          <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as (typeof ACTIONS)[number])}>
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
          <Label className="text-xs">Kullanıcı ID</Label>
          <Input
            className="h-8 text-xs"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            placeholder="UUID"
          />
        </div>

        <Button size="sm" className="h-8 text-xs" onClick={loadLogs} disabled={loading}>
          Uygula
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-lg border bg-white overflow-auto max-h-[70vh]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 z-10">
            <tr>
              <th className="px-3 py-2 text-left">Zaman</th>
              <th className="px-3 py-2 text-left">İşlem</th>
              <th className="px-3 py-2 text-left">Tablo</th>
              <th className="px-3 py-2 text-left">Kullanıcı</th>
              <th className="px-3 py-2 text-left">Kayıt ID</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Kayıt yok</td></tr>
            ) : (
              logs.map((log, idx) => (
                <tr key={log.id} className={`border-t ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(log.created_at).toLocaleString("tr-TR")}</td>
                  <td className="px-3 py-2 font-medium">{log.action}</td>
                  <td className="px-3 py-2">{log.table_name}</td>
                  <td className="px-3 py-2">{log.actor?.full_name || log.user_id}</td>
                  <td className="px-3 py-2 font-mono">{log.record_id || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
