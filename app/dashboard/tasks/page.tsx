"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { TaskView } from "@/components/tasks/task-view";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkerTask, AppRole } from "@/lib/types";
import { ROLE_LABELS, TASK_STATUS_LABELS } from "@/lib/types";
import { isWorkerRole, resolveRoleByIdentity } from "@/lib/rbac";
import { ClipboardList } from "lucide-react";

interface AdminTask extends WorkerTask {
  assignee_name?: string | null;
  assigned_by_name?: string | null;
  order_status?: string;
}

const DEPT_OPTIONS = [
  { value: "all", label: "Tüm Departmanlar" },
  { value: "warehouse", label: "Depo" },
  { value: "production", label: "Üretim" },
  { value: "shipping", label: "Sevkiyat" },
];

const taskStatusBg: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  preparing: "bg-yellow-100 text-yellow-800",
  ready: "bg-green-100 text-green-700",
  done: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [role, setRole] = useState<AppRole | null>(null);
  const [deptFilter, setDeptFilter] = useState("all");

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

  const loadTasks = useCallback(async () => {
    const url = role && !isWorkerRole(role)
      ? `/api/tasks/my?department=${deptFilter}`
      : "/api/tasks/my";
    const res = await fetch(url);
    if (res.ok) setTasks(await res.json());
  }, [deptFilter, role]);

  useEffect(() => { if (role) loadTasks(); }, [loadTasks, role]);

  const isAdmin = role && !isWorkerRole(role);

  const pendingCount = tasks.filter((t) => t.status === "pending").length;
  const inProgressCount = tasks.filter((t) => ["in_progress", "preparing"].includes(t.status)).length;
  const doneCount = tasks.filter((t) => t.status === "done").length;

  if (isAdmin) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <ClipboardList className="h-5 w-5 text-blue-600" />
          <h1 className="text-xl font-bold">Görev Yönetimi</h1>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-[200px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2 text-xs">
            <Badge variant="outline" className="bg-gray-50">Bekleyen: {pendingCount}</Badge>
            <Badge variant="outline" className="bg-blue-50">Devam Eden: {inProgressCount}</Badge>
            <Badge variant="outline" className="bg-green-50">Tamamlanan: {doneCount}</Badge>
          </div>
        </div>

        {tasks.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-lg text-muted-foreground">Henüz görev atanmadı. Siparişler sayfasından görev atayabilirsiniz.</p>
          </div>
        ) : (
          <div className="rounded-lg border bg-white shadow-sm overflow-auto max-h-[calc(100vh-200px)]">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Sipariş No</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Müşteri</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Ürün</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Departman</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Atanan</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Atayan</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Öncelik</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Durum</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Termin</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Not</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task, i) => (
                  <tr key={task.id} className={`border-b hover:bg-blue-50/50 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/30"}`}>
                    <td className="px-3 py-2 font-mono font-semibold text-blue-700">{task.order_no}</td>
                    <td className="px-3 py-2">{task.customer}</td>
                    <td className="px-3 py-2">{task.product_type}{task.micron ? ` ${task.micron}µ` : ""}{task.width ? ` ${task.width}mm` : ""}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{ROLE_LABELS[task.department as AppRole] || task.department}</Badge>
                    </td>
                    <td className="px-3 py-2">{task.assignee_name || <span className="text-muted-foreground">Departman</span>}</td>
                    <td className="px-3 py-2">{task.assigned_by_name || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2">
                      <span className={task.priority === "urgent" ? "text-red-600 font-bold" : task.priority === "high" ? "text-orange-600 font-semibold" : ""}>
                        {task.priority === "urgent" ? "🔴 Acil" : task.priority === "high" ? "🟠 Yüksek" : task.priority === "normal" ? "Normal" : "Düşük"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={`text-[10px] ${taskStatusBg[task.status] || ""}`}>
                        {TASK_STATUS_LABELS[task.status] || task.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{task.due_date ? new Date(task.due_date).toLocaleDateString("tr-TR") : "—"}</td>
                    <td className="px-3 py-2 max-w-[150px] truncate">{task.progress_note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Görevlerim</h1>
      <p className="text-sm text-slate-500">
        Bu ekran görev önceliği ve durum takibi içindir. Kg/bobin girişleri ilgili giriş ekranlarından yapılır.
      </p>
      <TaskView tasks={tasks} />
    </div>
  );
}
