import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canCompleteShipping, canManageShippingSchedule, canViewShippingSchedule } from "@/lib/rbac";
import { shippingScheduleUpdateSchema } from "@/lib/validations";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (!canViewShippingSchedule(auth.role, auth.fullName)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("shipping_schedules")
    .select(`
      *,
      order:orders!inner(id, order_no, customer, product_type, quantity, unit, priority, status, ship_date),
      creator:profiles!shipping_schedules_created_by_fkey(id, full_name, role),
      completer:profiles!shipping_schedules_completed_by_fkey(id, full_name, role)
    `)
    .eq("id", params.id)
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Plan bulunamadı" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = shippingScheduleUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const isCompletion = parsed.data.status === "completed";
  const canManage = canManageShippingSchedule(auth.role, auth.fullName);
  const canComplete = canCompleteShipping(auth.role, auth.fullName);

  if (isCompletion) {
    if (!canComplete) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  } else if (!canManage) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data: before, error: beforeError } = await supabase
    .from("shipping_schedules")
    .select("*")
    .eq("id", params.id)
    .single();
  if (beforeError || !before) return NextResponse.json({ error: beforeError?.message || "Plan bulunamadı" }, { status: 404 });

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "completed") {
    updateData.completed_by = auth.userId;
    updateData.completed_at = new Date().toISOString();
  } else if (parsed.data.status) {
    updateData.completed_by = null;
    updateData.completed_at = null;
  }

  const { data, error } = await supabase
    .from("shipping_schedules")
    .update(updateData)
    .eq("id", params.id)
    .select()
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message || "Güncelleme hatası" }, { status: 500 });

  if (parsed.data.status === "completed") {
    await supabase
      .from("orders")
      .update({ status: "shipped" })
      .eq("id", before.order_id)
      .in("status", ["ready", "confirmed", "in_production"]);
  }

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "UPDATE",
    table_name: "shipping_schedules",
    record_id: params.id,
    old_data: before,
    new_data: data,
  });

  return NextResponse.json(data);
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canManageShippingSchedule(auth.role, auth.fullName)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data: before } = await supabase
    .from("shipping_schedules")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!before) return NextResponse.json({ error: "Plan bulunamadı" }, { status: 404 });

  const { error } = await supabase.from("shipping_schedules").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "DELETE",
    table_name: "shipping_schedules",
    record_id: params.id,
    old_data: before,
    new_data: null,
  });

  return NextResponse.json({ success: true });
}
