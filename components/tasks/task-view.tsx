"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TASK_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/types";
import type { WorkerTask, TaskStatus } from "@/lib/types";
import { toast } from "@/hooks/use-toast";

interface TaskViewProps {
  tasks: WorkerTask[];
  onUpdate: () => void;
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

const ACTION_BUTTONS: { status: TaskStatus; label: string; color: string }[] = [
  { status: "in_progress", label: "Başla", color: "bg-blue-600 hover:bg-blue-700 text-white" },
  { status: "preparing", label: "Hazırlanıyor", color: "bg-yellow-600 hover:bg-yellow-700 text-white" },
  { status: "ready", label: "Hazır", color: "bg-green-600 hover:bg-green-700 text-white" },
  { status: "done", label: "Bitti", color: "bg-emerald-700 hover:bg-emerald-800 text-white" },
];

export function TaskView({ tasks, onUpdate }: TaskViewProps) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

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

  async function handleStatusChange(taskId: string, status: TaskStatus) {
    setUpdating(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}/progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          ready_quantity: quantities[taskId] ? Number(quantities[taskId]) : null,
          progress_note: notes[taskId] || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Hata");
      }
      toast({ title: "Görev güncellendi" });
      onUpdate();
    } catch (err: unknown) {
      toast({ title: "Hata", description: err instanceof Error ? err.message : "Bilinmeyen hata", variant: "destructive" });
    } finally {
      setUpdating(null);
    }
  }

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
          const isExpanded = expandedTaskId === task.id;
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

                <div className="flex gap-2">
                  {ACTION_BUTTONS.filter((btn) => btn.status !== task.status).map((btn) => (
                    <Button
                      key={btn.status}
                      className={`h-9 text-sm font-semibold ${btn.color}`}
                      disabled={updating === task.id}
                      onClick={() => handleStatusChange(task.id, btn.status)}
                    >
                      {updating === task.id ? "..." : btn.label}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    className="h-9 text-sm"
                    onClick={() => setExpandedTaskId((prev) => (prev === task.id ? null : task.id))}
                  >
                    {isExpanded ? "Güncellemeyi Gizle" : "Detaylı Güncelle"}
                  </Button>
                </div>

                {isExpanded && (
                  <div className="space-y-2 border-t pt-3">
                    <Input
                      type="number"
                      placeholder="Hazır miktar (opsiyonel)"
                      value={quantities[task.id] || ""}
                      onChange={(e) => setQuantities((prev) => ({ ...prev, [task.id]: e.target.value }))}
                    />
                    <Textarea
                      placeholder="İlerleme notu (opsiyonel)"
                      value={notes[task.id] || ""}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [task.id]: e.target.value }))}
                      className="min-h-[70px]"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
