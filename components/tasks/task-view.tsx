"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TASK_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/types";
import type { WorkerTask } from "@/lib/types";

interface TaskViewProps {
  tasks: WorkerTask[];
}

const statusColor: Record<string, string> = {
  pending: "bg-gray-100 border-gray-300",
  in_progress: "bg-blue-50 border-blue-300",
  preparing: "bg-yellow-50 border-yellow-300",
  ready: "bg-green-50 border-green-300",
  done: "bg-green-100 border-green-400",
  cancelled: "bg-red-50 border-red-300",
};

const priorityColor: Record<string, string> = {
  low: "text-gray-500",
  normal: "text-blue-600",
  high: "text-orange-700 font-semibold",
  urgent: "text-red-700 font-bold",
};

function getTrackingHint(department: string): string {
  if (department === "warehouse") return "Detay/giriş: Depo Girişi";
  if (department === "production") return "Detay/giriş: Bobin Girişi / Üretim Planları";
  if (department === "shipping") return "Detay/giriş: Sevkiyat Programı";
  return "Detay/giriş: ilgili operasyon menüsü";
}

export function TaskView({ tasks }: TaskViewProps) {

  const sortedTasks = useMemo(() => {
    const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    return [...tasks].sort((a, b) => {
      const pDiff = (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
      if (pDiff !== 0) return pDiff;
      const aDue = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    });
  }, [tasks]);

  const stats = useMemo(() => {
    const now = Date.now();
    const urgent = tasks.filter((t) => t.priority === "urgent").length;
    const overdue = tasks.filter((t) => t.due_date && new Date(t.due_date).getTime() < now && t.status !== "done").length;
    const active = tasks.filter((t) => ["pending", "in_progress", "preparing", "ready"].includes(t.status)).length;
    const done = tasks.filter((t) => t.status === "done").length;
    return { urgent, overdue, active, done };
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-lg text-muted-foreground">Atanmış görev bulunmuyor</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Aktif</p><p className="text-xl font-bold">{stats.active}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Acil</p><p className="text-xl font-bold text-red-700">{stats.urgent}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Termin Geçmiş</p><p className="text-xl font-bold text-orange-700">{stats.overdue}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Tamamlanan</p><p className="text-xl font-bold text-green-700">{stats.done}</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sortedTasks.map((task) => {
          const isOverdue = !!task.due_date && new Date(task.due_date).getTime() < Date.now() && task.status !== "done";
          return (
            <Card key={task.id} className={`border-2 ${statusColor[task.status] || ""} ${task.priority === "urgent" ? "ring-1 ring-red-300" : ""}`}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">{task.order_no}</CardTitle>
                  <Badge variant="outline" className={priorityColor[task.priority] || ""}>
                    {PRIORITY_LABELS[task.priority]}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge>{TASK_STATUS_LABELS[task.status]}</Badge>
                  {task.due_date && (
                    <Badge variant={isOverdue ? "destructive" : "secondary"}>
                      Termin: {new Date(task.due_date).toLocaleDateString("tr-TR")}
                    </Badge>
                  )}
                  <span className="text-sm text-muted-foreground">{task.customer}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Ürün:</span> {task.product_type}</div>
                  {task.micron && <div><span className="text-muted-foreground">Mikron:</span> {task.micron}</div>}
                  {task.width && <div><span className="text-muted-foreground">En:</span> {task.width} mm</div>}
                  {task.quantity && <div><span className="text-muted-foreground">Miktar:</span> {task.quantity} {task.unit}</div>}
                </div>

                {(task.progress_note || task.ready_quantity) && (
                  <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded">
                    {task.ready_quantity != null && <div>Son Hazır Miktar: {task.ready_quantity}</div>}
                    {task.progress_note && <div>Son Not: {task.progress_note}</div>}
                  </div>
                )}

                {task.order_notes && (
                  <p className="text-sm text-muted-foreground bg-muted/50 p-2 rounded">{task.order_notes}</p>
                )}

                <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                  <p className="text-xs text-slate-600">
                    Bu ekran sadece iş takibi içindir. {getTrackingHint(task.department)} menüsünden işlem yapılır.
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
