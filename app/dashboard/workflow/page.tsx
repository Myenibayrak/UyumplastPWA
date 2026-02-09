"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AppRole, WorkerTask } from "@/lib/types";
import { ROLE_LABELS, TASK_STATUS_LABELS } from "@/lib/types";
import { isWorkerRole, resolveRoleByIdentity } from "@/lib/rbac";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";

type WorkflowTask = WorkerTask & {
  assignee_name?: string | null;
  assigned_by_name?: string | null;
};

export default function WorkflowPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(false);

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

  const load = useCallback(async () => {
    if (!role) return;
    setLoading(true);
    try {
      const url = isWorkerRole(role) ? "/api/tasks/my" : "/api/tasks/my?department=all";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("İş akışı yüklenemedi");
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    if (role) load();
  }, [role, load]);

  const grouped = useMemo(() => {
    const map = new Map<string, WorkflowTask[]>();
    for (const task of tasks) {
      const key = task.department;
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [tasks]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Kim Ne Yapıyor - İş Akışı</h1>
          <p className="text-sm text-slate-500">Tüm aktif görevlerin departman ve kişi bazlı canlı görünümü.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCcw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Yenile
        </Button>
      </div>

      {grouped.length === 0 ? (
        <div className="bg-white border rounded-lg p-10 text-center text-slate-500">Aktif görev bulunmuyor.</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([department, list]) => (
            <div key={department} className="bg-white border rounded-lg">
              <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between">
                <h2 className="text-sm font-semibold">{ROLE_LABELS[department as AppRole] || department}</h2>
                <Badge variant="outline">{list.length} görev</Badge>
              </div>
              <div className="divide-y">
                {list.map((task) => (
                  <div key={task.id} className="p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-blue-700">{task.order_no}</p>
                      <Badge className="text-[10px]">{TASK_STATUS_LABELS[task.status] || task.status}</Badge>
                    </div>
                    <p className="text-xs text-slate-600">{task.customer} - {task.product_type}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                      <span>Kişi: {task.assignee_name || "Departman Havuzu"}</span>
                      {task.assigned_by_name && <span>Atayan: {task.assigned_by_name}</span>}
                      <span>Öncelik: {task.priority}</span>
                      {task.due_date && <span>Termin: {new Date(task.due_date).toLocaleDateString("tr-TR")}</span>}
                      <span>Sipariş Tarihi: {task.ship_date ? new Date(task.ship_date).toLocaleDateString("tr-TR") : "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
