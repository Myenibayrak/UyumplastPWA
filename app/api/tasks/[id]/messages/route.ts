import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { taskMessageCreateSchema } from "@/lib/validations";

const MANAGER_ROLES = new Set(["admin", "sales", "accounting"]);

type TaskContext = {
  id: string;
  department: string;
  assigned_to: string | null;
  assigned_by: string | null;
  order: { created_by: string | null; order_no: string | null; customer: string | null } | null;
};

function canAccessTask(auth: { userId: string; role: string }, task: TaskContext): boolean {
  if (MANAGER_ROLES.has(auth.role)) return true;
  if (task.assigned_to === auth.userId) return true;
  if (task.assigned_by === auth.userId) return true;
  if (task.order?.created_by === auth.userId) return true;
  return task.department === auth.role;
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const supabase = createAdminClient();

  const { data: task, error: taskError } = await supabase
    .from("order_tasks")
    .select("id, department, assigned_to, assigned_by, order:orders!inner(created_by, order_no, customer)")
    .eq("id", params.id)
    .single();

  if (taskError || !task) return NextResponse.json({ error: taskError?.message || "Görev bulunamadı" }, { status: 404 });
  if (!canAccessTask(auth, task as unknown as TaskContext)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("task_messages")
    .select(`
      *,
      sender:profiles!task_messages_sender_id_fkey(id, full_name, role)
    `)
    .eq("task_id", params.id)
    .order("created_at", { ascending: true })
    .limit(400);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = taskMessageCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createAdminClient();

  const { data: task, error: taskError } = await supabase
    .from("order_tasks")
    .select("id, department, assigned_to, assigned_by, order:orders!inner(created_by, order_no, customer)")
    .eq("id", params.id)
    .single();

  if (taskError || !task) return NextResponse.json({ error: taskError?.message || "Görev bulunamadı" }, { status: 404 });
  if (!canAccessTask(auth, task as unknown as TaskContext)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (parsed.data.parent_id) {
    const { data: parent } = await supabase
      .from("task_messages")
      .select("id, task_id")
      .eq("id", parsed.data.parent_id)
      .single();

    if (!parent || parent.task_id !== params.id) {
      return NextResponse.json({ error: "Yanıt mesajı bu göreve ait değil" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("task_messages")
    .insert({
      task_id: params.id,
      sender_id: auth.userId,
      parent_id: parsed.data.parent_id ?? null,
      message: parsed.data.message.trim(),
    })
    .select(`
      *,
      sender:profiles!task_messages_sender_id_fkey(id, full_name, role)
    `)
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Mesaj gönderilemedi" }, { status: 500 });

  const recipients = new Set<string>();
  const taskRow = task as unknown as TaskContext;
  if (taskRow.assigned_to) recipients.add(taskRow.assigned_to);
  if (taskRow.assigned_by) recipients.add(taskRow.assigned_by);
  if (taskRow.order?.created_by) recipients.add(taskRow.order.created_by);

  const { data: participants } = await supabase
    .from("task_messages")
    .select("sender_id")
    .eq("task_id", params.id);

  for (const p of participants ?? []) {
    const senderId = (p as { sender_id: string | null }).sender_id;
    if (senderId) recipients.add(senderId);
  }

  recipients.delete(auth.userId);

  if (recipients.size > 0) {
    const notificationRows = Array.from(recipients).map((userId) => ({
      user_id: userId,
      title: `Görev Mesajı: ${taskRow.order?.order_no || "Sipariş"}`,
      body: `${auth.fullName || "Bir kullanıcı"}: ${parsed.data.message.trim().slice(0, 140)}`,
      type: "task_message",
      ref_id: params.id,
    }));

    await supabase.from("notifications").insert(notificationRows);
  }

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "task_messages",
    record_id: data.id,
    old_data: null,
    new_data: data,
  });

  return NextResponse.json(data, { status: 201 });
}
