import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";
import { orderUpdateSchema, taskAssignSchema } from "@/lib/validations";
import { canCloseOrders, canViewFinance, stripFinanceFields } from "@/lib/rbac";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const supabase = createAdminClient();
  let { data, error } = await supabase
    .from("orders")
    .select("*, order_tasks(*, assignee:profiles!order_tasks_assigned_to_fkey(id, full_name, role))")
    .eq("id", params.id)
    .single();

  // Fallback to auth-bound server client if service-role env is missing/misconfigured.
  if (error || !data) {
    const serverSupabase = createServerSupabase();
    const retry = await serverSupabase
      .from("orders")
      .select("*, order_tasks(*, assignee:profiles!order_tasks_assigned_to_fkey(id, full_name, role))")
      .eq("id", params.id)
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const order = canViewFinance(auth.role) ? data : stripFinanceFields(data as Record<string, unknown>);
  return NextResponse.json(order);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, ["admin", "sales", "accounting"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = orderUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.status === "closed" && !canCloseOrders(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updateData: Record<string, unknown> = { ...parsed.data };
  const nowIso = new Date().toISOString();
  if (parsed.data.status === "closed" || parsed.data.status === "cancelled") {
    updateData.closed_by = auth.userId;
    updateData.closed_at = nowIso;
  } else if (parsed.data.status) {
    updateData.closed_by = null;
    updateData.closed_at = null;
  }

  const supabase = createAdminClient();
  const { data: before } = await supabase
    .from("orders")
    .select("*")
    .eq("id", params.id)
    .single();
  let { data, error } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", params.id)
    .select()
    .single();

  // Fallback for environments where closed_by/closed_at columns are not migrated yet.
  if (error && /closed_by|closed_at/i.test(error.message || "")) {
    delete updateData.closed_by;
    delete updateData.closed_at;
    ({ data, error } = await supabase
      .from("orders")
      .update(updateData)
      .eq("id", params.id)
      .select()
      .single());
  }

  // Fallback for environments where order_status enum does not yet include "closed".
  if (
    error
    && parsed.data.status === "closed"
    && /invalid input value for enum order_status/i.test(error.message || "")
  ) {
    const retryData = { ...updateData, status: "cancelled" as const };
    ({ data, error } = await supabase
      .from("orders")
      .update(retryData)
      .eq("id", params.id)
      .select()
      .single());
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "UPDATE",
    table_name: "orders",
    record_id: params.id,
    old_data: before ?? null,
    new_data: data,
  });

  const order = canViewFinance(auth.role) ? data : stripFinanceFields(data as Record<string, unknown>);
  return NextResponse.json(order);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, ["admin"]);
  if (roleCheck) return roleCheck;

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("orders")
    .select("*")
    .eq("id", params.id)
    .single();
  if (existing) {
    await supabase.from("audit_logs").insert({
      user_id: auth.userId,
      action: "DELETE",
      table_name: "orders",
      record_id: params.id,
      old_data: existing,
      new_data: null,
    });
  }
  const { error } = await supabase.from("orders").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, ["admin", "sales"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = taskAssignSchema.safeParse({ ...body as Record<string, unknown>, order_id: params.id });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createAdminClient();
  const taskInsertData = {
    order_id: parsed.data.order_id,
    department: parsed.data.department,
    assigned_to: parsed.data.assigned_to ?? null,
    priority: parsed.data.priority,
    due_date: parsed.data.due_date ?? null,
    assigned_by: auth.userId,
  };
  let { data, error } = await supabase
    .from("order_tasks")
    .insert(taskInsertData)
    .select()
    .single();

  // Fallback for environments where order_tasks.assigned_by column is not migrated yet.
  if (error && /assigned_by/i.test(error.message || "")) {
    ({ data, error } = await supabase
      .from("order_tasks")
      .insert({
        order_id: parsed.data.order_id,
        department: parsed.data.department,
        assigned_to: parsed.data.assigned_to ?? null,
        priority: parsed.data.priority,
        due_date: parsed.data.due_date ?? null,
      })
      .select()
      .single());
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "order_tasks",
    record_id: data.id,
    old_data: null,
    new_data: data,
  });

  const taskMessage = parsed.data.message?.trim();
  if (taskMessage) {
    const { data: taskMsgData, error: taskMsgError } = await supabase
      .from("task_messages")
      .insert({
        task_id: data.id,
        sender_id: auth.userId,
        message: taskMessage,
      })
      .select()
      .single();

    if (taskMsgError) return NextResponse.json({ error: taskMsgError.message }, { status: 500 });

    const recipients = new Set<string>();
    if (data.assigned_to) recipients.add(data.assigned_to as string);
    recipients.delete(auth.userId);

    if (recipients.size > 0) {
      await supabase.from("notifications").insert(
        Array.from(recipients).map((userId) => ({
          user_id: userId,
          title: "Yeni Görev Mesajı",
          body: `${auth.fullName || "Bir kullanıcı"}: ${taskMessage.slice(0, 140)}`,
          type: "task_message",
          ref_id: data.id as string,
        }))
      );
    }

    await supabase.from("audit_logs").insert({
      user_id: auth.userId,
      action: "INSERT",
      table_name: "task_messages",
      record_id: (taskMsgData as { id: string }).id,
      old_data: null,
      new_data: taskMsgData,
    });
  }

  return NextResponse.json(data, { status: 201 });
}
