import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";
import { orderUpdateSchema, taskAssignSchema } from "@/lib/validations";
import { canViewFinance, stripFinanceFields } from "@/lib/rbac";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_tasks(*, assignee:profiles!order_tasks_assigned_to_fkey(id, full_name, role))")
    .eq("id", params.id)
    .single();

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

  if (parsed.data.status === "closed" && auth.role !== "admin" && auth.role !== "accounting") {
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const order = canViewFinance(auth.role) ? data : stripFinanceFields(data as Record<string, unknown>);
  return NextResponse.json(order);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, ["admin"]);
  if (roleCheck) return roleCheck;

  const supabase = createAdminClient();
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
  const { data, error } = await supabase
    .from("order_tasks")
    .insert({ ...parsed.data, assigned_by: auth.userId })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
