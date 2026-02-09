"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AppRole, HandoverNote, Priority } from "@/lib/types";
import { APP_ROLES, HANDOVER_STATUS_LABELS, PRIORITY_LABELS, ROLE_LABELS } from "@/lib/types";
import { canManageAllHandover, canViewHandover, resolveRoleByIdentity } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, RefreshCcw } from "lucide-react";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function priorityClass(priority: Priority) {
  if (priority === "urgent") return "bg-red-100 text-red-700";
  if (priority === "high") return "bg-orange-100 text-orange-700";
  if (priority === "normal") return "bg-blue-100 text-blue-700";
  return "bg-slate-100 text-slate-700";
}

function statusClass(status: HandoverNote["status"]) {
  if (status === "resolved") return "bg-emerald-100 text-emerald-700";
  return "bg-amber-100 text-amber-800";
}

export default function HandoverPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [userId, setUserId] = useState("");
  const [notes, setNotes] = useState<HandoverNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState(todayIso());

  const [form, setForm] = useState({
    department: "",
    shift_date: todayIso(),
    title: "",
    details: "",
    priority: "normal" as Priority,
  });

  const canView = canViewHandover(role);
  const canManageAll = canManageAllHandover(role);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", user.id)
        .single();
      if (profile) {
        const resolved = resolveRoleByIdentity(profile.role as AppRole, profile.full_name || "");
        if (resolved) {
          setRole(resolved);
          setForm((prev) => ({ ...prev, department: resolved }));
        }
      }
    });
  }, []);

  const departmentOptions = useMemo(() => {
    if (!role) return [] as AppRole[];
    if (canManageAll) return APP_ROLES;
    return [role];
  }, [canManageAll, role]);

  const loadNotes = useCallback(async () => {
    if (!canView || !role) return;

    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set("limit", "300");
      if (deptFilter !== "all") q.set("department", deptFilter);
      if (statusFilter !== "all") q.set("status", statusFilter);
      if (dateFilter) q.set("shift_date", dateFilter);

      const res = await fetch(`/api/handover-notes?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Devir notları yüklenemedi");
      }

      const data = await res.json();
      setNotes(Array.isArray(data) ? data : []);
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [canView, dateFilter, deptFilter, role, statusFilter]);

  useEffect(() => {
    if (!role) return;
    void loadNotes();
  }, [role, loadNotes]);

  useEffect(() => {
    if (!canView) return;
    const timer = setInterval(() => {
      void loadNotes();
    }, 12000);
    return () => clearInterval(timer);
  }, [canView, loadNotes]);

  const openCount = notes.filter((n) => n.status === "open").length;
  const resolvedCount = notes.filter((n) => n.status === "resolved").length;

  async function createNote() {
    if (!form.department || !form.title.trim() || !form.details.trim()) {
      toast({ title: "Zorunlu alanlar eksik", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/handover-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department: form.department,
          shift_date: form.shift_date,
          title: form.title.trim(),
          details: form.details.trim(),
          priority: form.priority,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Devir notu oluşturulamadı");
      }

      toast({ title: "Devir notu kaydedildi" });
      setDialogOpen(false);
      setForm((prev) => ({ ...prev, title: "", details: "", priority: "normal", shift_date: todayIso() }));
      await loadNotes();
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function patchNote(id: string, payload: Record<string, unknown>, successText: string) {
    try {
      const res = await fetch(`/api/handover-notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Devir notu güncellenemedi");
      }
      toast({ title: successText });
      await loadNotes();
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" });
    }
  }

  async function deleteNote(id: string) {
    try {
      const res = await fetch(`/api/handover-notes/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Silme hatası");
      }
      toast({ title: "Devir notu silindi" });
      await loadNotes();
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" });
    }
  }

  if (role && !canView) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-lg border border-slate-200 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">Devir-Teslim Yetkisi Yok</h1>
        <p className="text-sm text-slate-600">Bu ekran kimlik doğrulanmış kullanıcılar için kullanılabilir durumda değil.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Devir-Teslim</h1>
          <p className="text-sm text-slate-500">Vardiya/ekip devir notlarını tek ekrandan takip edin.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadNotes()}>
            <RefreshCcw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Yenile
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Yeni Not
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-white p-3">
          <p className="text-xs text-slate-500">Toplam</p>
          <p className="text-2xl font-bold text-slate-900">{notes.length}</p>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <p className="text-xs text-slate-500">Açık</p>
          <p className="text-2xl font-bold text-amber-700">{openCount}</p>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <p className="text-xs text-slate-500">Çözüldü</p>
          <p className="text-2xl font-bold text-emerald-700">{resolvedCount}</p>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <p className="text-xs text-slate-500">Yetki Modu</p>
          <p className="text-sm font-semibold text-slate-700">{canManageAll ? "Yönetim" : "Departman"}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Departman</Label>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              {departmentOptions.map((dept) => (
                <SelectItem key={dept} value={dept}>{ROLE_LABELS[dept]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Durum</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="open">Açık</SelectItem>
              <SelectItem value="resolved">Çözüldü</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Vardiya Tarihi</Label>
          <Input type="date" className="h-8 text-xs" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
        </div>

        <Button size="sm" className="h-8 text-xs" onClick={() => void loadNotes()} disabled={loading}>Uygula</Button>
      </div>

      <div className="space-y-2">
        {notes.length === 0 ? (
          <div className="rounded-lg border bg-white p-10 text-center text-slate-500">Devir notu bulunamadı.</div>
        ) : (
          notes.map((note) => {
            const canEditRow = canManageAll || note.created_by === userId;
            const canDeleteRow = canManageAll || (note.created_by === userId && note.status === "open");

            return (
              <div key={note.id} className="rounded-xl border bg-white p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{note.title}</p>
                    <p className="text-xs text-slate-500">
                      {ROLE_LABELS[note.department]} | {new Date(`${note.shift_date}T00:00:00`).toLocaleDateString("tr-TR")}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Badge className={`text-[10px] ${priorityClass(note.priority)}`}>{PRIORITY_LABELS[note.priority]}</Badge>
                    <Badge className={`text-[10px] ${statusClass(note.status)}`}>{HANDOVER_STATUS_LABELS[note.status]}</Badge>
                  </div>
                </div>

                <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.details}</p>

                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>Oluşturan: {note.creator?.full_name || "—"}</span>
                  <span>Oluşturma: {new Date(note.created_at).toLocaleString("tr-TR")}</span>
                  {note.resolver?.full_name && <span>Çözen: {note.resolver.full_name}</span>}
                  {note.resolved_at && <span>Çözüm: {new Date(note.resolved_at).toLocaleString("tr-TR")}</span>}
                </div>

                {note.resolved_note && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                    Çözüm notu: {note.resolved_note}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {canEditRow && note.status === "open" && (
                    <Button size="sm" className="h-7 text-xs" onClick={() => void patchNote(note.id, { status: "resolved" }, "Devir notu çözüldü")}>Çözüldü</Button>
                  )}
                  {canEditRow && note.status === "resolved" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void patchNote(note.id, { status: "open" }, "Devir notu tekrar açıldı")}>Tekrar Aç</Button>
                  )}
                  {canDeleteRow && (
                    <Button size="sm" variant="outline" className="h-7 text-xs text-red-600" onClick={() => void deleteNote(note.id)}>Sil</Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni Devir Notu</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Departman</Label>
              <Select
                value={form.department || "__none__"}
                onValueChange={(v) => setForm((prev) => ({ ...prev, department: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Seçin" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Seçin</SelectItem>
                  {departmentOptions.map((dept) => (
                    <SelectItem key={dept} value={dept}>{ROLE_LABELS[dept]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Tarih</Label>
              <Input type="date" value={form.shift_date} onChange={(e) => setForm((prev) => ({ ...prev, shift_date: e.target.value }))} />
            </div>

            <div className="space-y-1">
              <Label>Öncelik</Label>
              <Select
                value={form.priority}
                onValueChange={(v) => setForm((prev) => ({ ...prev, priority: v as Priority }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Düşük</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Yüksek</SelectItem>
                  <SelectItem value="urgent">Acil</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Başlık</Label>
              <Input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Örn: Vardiya başlangıcı kritik not" />
            </div>

            <div className="space-y-1">
              <Label>Detay</Label>
              <Textarea
                value={form.details}
                onChange={(e) => setForm((prev) => ({ ...prev, details: e.target.value }))}
                placeholder="Yapılanlar, bekleyenler, riskler..."
                className="min-h-[120px]"
              />
            </div>

            <Button className="w-full" onClick={() => void createNote()} disabled={saving}>
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
