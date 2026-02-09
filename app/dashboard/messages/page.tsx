"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AppRole, DirectMessage, TaskMessage, WorkerTask } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { RefreshCcw, Reply } from "lucide-react";
import { isWorkerRole, resolveRoleByIdentity } from "@/lib/rbac";
import { toast } from "@/hooks/use-toast";

type UserLite = { id: string; full_name: string; role: AppRole };
type DirectConversation = {
  counterpart_id: string;
  last_message: string;
  last_at: string;
  unread_count: number;
  counterpart: UserLite | null;
};

type TaskLite = Pick<WorkerTask, "id" | "order_no" | "customer" | "department" | "status" | "priority">;

function fmtDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleString("tr-TR");
}

export default function MessagesPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [userId, setUserId] = useState("");
  const [users, setUsers] = useState<UserLite[]>([]);
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [selectedCounterpartId, setSelectedCounterpartId] = useState("");
  const [directMessages, setDirectMessages] = useState<DirectMessage[]>([]);
  const [directInput, setDirectInput] = useState("");
  const [directReplyParentId, setDirectReplyParentId] = useState<string>("");

  const [tasks, setTasks] = useState<TaskLite[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [taskMessages, setTaskMessages] = useState<TaskMessage[]>([]);
  const [taskInput, setTaskInput] = useState("");
  const [taskReplyParentId, setTaskReplyParentId] = useState<string>("");

  const [loading, setLoading] = useState(false);

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
        if (resolved) setRole(resolved);
      }
    });
  }, []);

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/messages/users", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setUsers(Array.isArray(data) ? data : []);
  }, []);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/messages/direct", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const rows = Array.isArray(data) ? (data as DirectConversation[]) : [];
    setConversations(rows);
    if (!selectedCounterpartId && rows.length > 0) setSelectedCounterpartId(rows[0].counterpart_id);
  }, [selectedCounterpartId]);

  const loadDirectMessages = useCallback(async (counterpartId: string) => {
    if (!counterpartId) {
      setDirectMessages([]);
      return;
    }
    const res = await fetch(`/api/messages/direct?counterpart_id=${counterpartId}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setDirectMessages(Array.isArray(data) ? data : []);
  }, []);

  const loadTasks = useCallback(async () => {
    if (!role) return;
    const url = isWorkerRole(role) ? "/api/tasks/my" : "/api/tasks/my?department=all";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const rows = (Array.isArray(data) ? data : []) as TaskLite[];
    setTasks(rows);
    if (!selectedTaskId && rows.length > 0) setSelectedTaskId(rows[0].id);
  }, [role, selectedTaskId]);

  const loadTaskMessages = useCallback(async (taskId: string) => {
    if (!taskId) {
      setTaskMessages([]);
      return;
    }
    const res = await fetch(`/api/tasks/${taskId}/messages`, { cache: "no-store" });
    if (!res.ok) {
      setTaskMessages([]);
      return;
    }
    const data = await res.json();
    setTaskMessages(Array.isArray(data) ? data : []);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadUsers(), loadConversations(), loadTasks()]);
      if (selectedCounterpartId) await loadDirectMessages(selectedCounterpartId);
      if (selectedTaskId) await loadTaskMessages(selectedTaskId);
    } finally {
      setLoading(false);
    }
  }, [loadConversations, loadDirectMessages, loadTaskMessages, loadTasks, loadUsers, selectedCounterpartId, selectedTaskId]);

  useEffect(() => {
    if (!role) return;
    void refreshAll();
  }, [role, refreshAll]);

  useEffect(() => {
    if (!selectedCounterpartId) return;
    void loadDirectMessages(selectedCounterpartId);
  }, [selectedCounterpartId, loadDirectMessages]);

  useEffect(() => {
    if (!selectedTaskId) return;
    void loadTaskMessages(selectedTaskId);
  }, [selectedTaskId, loadTaskMessages]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!role) return;
      void loadConversations();
      if (selectedCounterpartId) void loadDirectMessages(selectedCounterpartId);
      if (selectedTaskId) void loadTaskMessages(selectedTaskId);
    }, 10000);
    return () => clearInterval(timer);
  }, [loadConversations, loadDirectMessages, loadTaskMessages, role, selectedCounterpartId, selectedTaskId]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedCounterpartId) || conversations.find((c) => c.counterpart_id === selectedCounterpartId)?.counterpart || null,
    [users, conversations, selectedCounterpartId]
  );

  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedTaskId) || null, [tasks, selectedTaskId]);

  async function sendDirectMessage() {
    if (!selectedCounterpartId) {
      toast({ title: "Kişi seçin", variant: "destructive" });
      return;
    }
    if (!directInput.trim()) return;

    const res = await fetch("/api/messages/direct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient_id: selectedCounterpartId,
        message: directInput.trim(),
        parent_id: directReplyParentId || null,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Hata", description: body?.error || "Mesaj gönderilemedi", variant: "destructive" });
      return;
    }

    setDirectInput("");
    setDirectReplyParentId("");
    await Promise.all([loadDirectMessages(selectedCounterpartId), loadConversations()]);
  }

  async function sendTaskMessage() {
    if (!selectedTaskId) {
      toast({ title: "Görev seçin", variant: "destructive" });
      return;
    }
    if (!taskInput.trim()) return;

    const res = await fetch(`/api/tasks/${selectedTaskId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: taskInput.trim(),
        parent_id: taskReplyParentId || null,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Hata", description: body?.error || "Mesaj gönderilemedi", variant: "destructive" });
      return;
    }

    setTaskInput("");
    setTaskReplyParentId("");
    await loadTaskMessages(selectedTaskId);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mesajlar</h1>
          <p className="text-sm text-slate-500">Direkt mesajlaşma ve görev konuşmaları burada yönetilir.</p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll}>
          <RefreshCcw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Yenile
        </Button>
      </div>

      <Tabs defaultValue="direct" className="space-y-3">
        <TabsList>
          <TabsTrigger value="direct">Direkt Mesaj</TabsTrigger>
          <TabsTrigger value="task">Görev Mesajları</TabsTrigger>
        </TabsList>

        <TabsContent value="direct" className="space-y-3">
          <div className="bg-white border rounded-lg p-3">
            <Label className="text-xs text-slate-500">Yeni Konuşma Başlat</Label>
            <Select value={selectedCounterpartId || "__none__"} onValueChange={(v) => setSelectedCounterpartId(v === "__none__" ? "" : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Kişi seçin" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Seçin</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.role})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="bg-white border rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b text-sm font-semibold">Konuşmalar</div>
              <div className="max-h-[55vh] overflow-auto divide-y">
                {conversations.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">Konuşma yok</p>
                ) : (
                  conversations.map((c) => (
                    <button
                      key={c.counterpart_id}
                      type="button"
                      onClick={() => setSelectedCounterpartId(c.counterpart_id)}
                      className={`w-full text-left p-3 hover:bg-slate-50 ${selectedCounterpartId === c.counterpart_id ? "bg-blue-50" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium truncate">{c.counterpart?.full_name || c.counterpart_id}</p>
                        {c.unread_count > 0 && <Badge className="text-[10px]">{c.unread_count}</Badge>}
                      </div>
                      <p className="text-xs text-slate-500 truncate">{c.last_message}</p>
                      <p className="text-[11px] text-slate-400">{fmtDate(c.last_at)}</p>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="lg:col-span-2 bg-white border rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b text-sm font-semibold">
                {selectedUser ? `${selectedUser.full_name} ile konuşma` : "Konuşma seçin"}
              </div>
              <div className="max-h-[46vh] overflow-auto p-3 space-y-2 bg-slate-50">
                {directMessages.length === 0 ? (
                  <p className="text-sm text-slate-500">Mesaj yok</p>
                ) : (
                  directMessages.map((m) => {
                    const mine = m.sender_id === userId;
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[90%] rounded-lg px-3 py-2 ${mine ? "bg-blue-600 text-white" : "bg-white border text-slate-800"}`}>
                          <p className="text-sm whitespace-pre-wrap">{m.message}</p>
                          <div className="mt-1 flex items-center justify-between gap-3">
                            <p className={`text-[11px] ${mine ? "text-blue-100" : "text-slate-400"}`}>{fmtDate(m.created_at)}</p>
                            <button
                              type="button"
                              className={`inline-flex items-center text-[11px] ${mine ? "text-blue-100" : "text-slate-500"}`}
                              onClick={() => setDirectReplyParentId(m.id)}
                            >
                              <Reply className="h-3 w-3 mr-1" /> Yanıtla
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="p-3 border-t space-y-2">
                {directReplyParentId && (
                  <div className="text-xs text-slate-500 flex items-center justify-between">
                    <span>Yanıt modu açık</span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setDirectReplyParentId("")}>İptal</Button>
                  </div>
                )}
                <div className="flex gap-2">
                  <Input value={directInput} onChange={(e) => setDirectInput(e.target.value)} placeholder="Mesaj yazın..." onKeyDown={(e) => { if (e.key === "Enter") void sendDirectMessage(); }} />
                  <Button onClick={sendDirectMessage}>Gönder</Button>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="task" className="space-y-3">
          <div className="bg-white border rounded-lg p-3 space-y-2">
            <Label>Görev Seçimi</Label>
            <Select value={selectedTaskId || "__none__"} onValueChange={(v) => setSelectedTaskId(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Görev seçin" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Seçin</SelectItem>
                {tasks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.order_no} - {t.customer} ({t.department})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTask && (
              <p className="text-xs text-slate-500">
                Durum: <b>{selectedTask.status}</b> | Öncelik: <b>{selectedTask.priority}</b>
              </p>
            )}
          </div>

          <div className="bg-white border rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b text-sm font-semibold">Görev Konuşması</div>
            <div className="max-h-[48vh] overflow-auto p-3 space-y-2 bg-slate-50">
              {taskMessages.length === 0 ? (
                <p className="text-sm text-slate-500">Mesaj yok</p>
              ) : (
                taskMessages.map((m) => {
                  const mine = m.sender_id === userId;
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[90%] rounded-lg px-3 py-2 ${mine ? "bg-emerald-600 text-white" : "bg-white border text-slate-800"}`}>
                        <p className="text-xs font-semibold opacity-90">{m.sender?.full_name || "Kullanıcı"}</p>
                        <p className="text-sm whitespace-pre-wrap">{m.message}</p>
                        <div className="mt-1 flex items-center justify-between gap-3">
                          <p className={`text-[11px] ${mine ? "text-emerald-100" : "text-slate-400"}`}>{fmtDate(m.created_at)}</p>
                          <button
                            type="button"
                            className={`inline-flex items-center text-[11px] ${mine ? "text-emerald-100" : "text-slate-500"}`}
                            onClick={() => setTaskReplyParentId(m.id)}
                          >
                            <Reply className="h-3 w-3 mr-1" /> Yanıtla
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-3 border-t space-y-2">
              {taskReplyParentId && (
                <div className="text-xs text-slate-500 flex items-center justify-between">
                  <span>Yanıt modu açık</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setTaskReplyParentId("")}>İptal</Button>
                </div>
              )}
              <Textarea value={taskInput} onChange={(e) => setTaskInput(e.target.value)} placeholder="Görev mesajı yazın..." className="min-h-[90px]" />
              <div className="flex justify-end">
                <Button onClick={sendTaskMessage}>Gönder</Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
