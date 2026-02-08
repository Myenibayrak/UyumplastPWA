"use client";

import { useState, useEffect, useCallback } from "react";
import { TaskView } from "@/components/tasks/task-view";
import type { WorkerTask } from "@/lib/types";

export default function TasksPage() {
  const [tasks, setTasks] = useState<WorkerTask[]>([]);

  const loadTasks = useCallback(async () => {
    const res = await fetch("/api/tasks/my");
    if (res.ok) setTasks(await res.json());
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Görevlerim</h1>
      <TaskView tasks={tasks} onUpdate={loadTasks} />
    </div>
  );
}
