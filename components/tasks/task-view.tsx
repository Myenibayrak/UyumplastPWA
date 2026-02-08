"use client";

import { useState } from "react";
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
  high: "text-orange-600 font-bold",
  urgent: "text-red-600 font-bold animate-pulse",
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {tasks.map((task) => (
        <Card key={task.id} className={`border-2 ${statusColor[task.status] || ""}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{task.order_no}</CardTitle>
              <Badge variant="outline" className={priorityColor[task.priority] || ""}>
                {PRIORITY_LABELS[task.priority]}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Badge>{TASK_STATUS_LABELS[task.status]}</Badge>
              <span className="text-sm text-muted-foreground">{task.customer}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Ürün:</span> {task.product_type}</div>
              {task.micron && <div><span className="text-muted-foreground">Mikron:</span> {task.micron}</div>}
              {task.width && <div><span className="text-muted-foreground">En:</span> {task.width} mm</div>}
              {task.quantity && <div><span className="text-muted-foreground">Miktar:</span> {task.quantity} {task.unit}</div>}
              {task.trim_width && <div><span className="text-muted-foreground">Kesim Eni:</span> {task.trim_width}</div>}
              {task.ship_date && <div><span className="text-muted-foreground">Sevk:</span> {new Date(task.ship_date).toLocaleDateString("tr-TR")}</div>}
            </div>

            {task.order_notes && (
              <p className="text-sm text-muted-foreground bg-muted/50 p-2 rounded">{task.order_notes}</p>
            )}

            <div className="space-y-2">
              <Input
                type="number"
                placeholder="Hazır miktar"
                value={quantities[task.id] || ""}
                onChange={(e) => setQuantities((prev) => ({ ...prev, [task.id]: e.target.value }))}
                className="h-12 text-lg"
              />
              <Textarea
                placeholder="İlerleme notu..."
                value={notes[task.id] || ""}
                onChange={(e) => setNotes((prev) => ({ ...prev, [task.id]: e.target.value }))}
                className="min-h-[60px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {ACTION_BUTTONS.filter((btn) => btn.status !== task.status).map((btn) => (
                <Button
                  key={btn.status}
                  className={`h-14 text-lg font-bold ${btn.color}`}
                  disabled={updating === task.id}
                  onClick={() => handleStatusChange(task.id, btn.status)}
                >
                  {updating === task.id ? "..." : btn.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
