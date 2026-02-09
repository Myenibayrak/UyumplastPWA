import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canCompleteShipping, canManageShippingSchedule, canViewShippingSchedule } from "@/lib/rbac";
import { shippingScheduleUpdateSchema } from "@/lib/validations";
import { isMissingTableError } from "@/lib/supabase/postgrest-errors";
import { deleteVirtualRow, getVirtualRowById, updateVirtualRow } from "@/lib/virtual-store";

type VirtualShippingRow = {
  id: string;
  order_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  sequence_no: number;
  status: "planned" | "completed" | "cancelled";
  notes: string | null;
  carry_count: number;
  created_by: string;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const VIRTUAL_TABLE = "virtual_shipping_schedules";

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

  if (error || !data) {
    if (isMissingTableError(error, "shipping_schedules")) {
      const row = await getVirtualRowById<VirtualShippingRow>(supabase, VIRTUAL_TABLE, params.id);
      if (!row) return NextResponse.json({ error: "Plan bulunamadı" }, { status: 404 });

      const [orderRes, creatorRes, completerRes] = await Promise.all([
        supabase
          .from("orders")
          .select("id, order_no, customer, product_type, quantity, unit, priority, status, ship_date")
          .eq("id", row.order_id)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("id, full_name, role")
          .eq("id", row.created_by)
          .maybeSingle(),
        row.completed_by
          ? supabase
              .from("profiles")
              .select("id, full_name, role")
              .eq("id", row.completed_by)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      return NextResponse.json({
        ...row,
        order: orderRes.data ?? null,
        creator: creatorRes.data ?? null,
        completer: completerRes.data ?? null,
      });
    }
    return NextResponse.json({ error: error?.message || "Plan bulunamadı" }, { status: 404 });
  }
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
  if (beforeError || !before) {
    if (isMissingTableError(beforeError, "shipping_schedules")) {
      const virtualBefore = await getVirtualRowById<VirtualShippingRow>(supabase, VIRTUAL_TABLE, params.id);
      if (!virtualBefore) return NextResponse.json({ error: "Plan bulunamadı" }, { status: 404 });

      const patch: Partial<VirtualShippingRow> = { ...parsed.data };
      if (parsed.data.status === "completed") {
        patch.completed_by = auth.userId;
        patch.completed_at = new Date().toISOString();
      } else if (parsed.data.status) {
        patch.completed_by = null;
        patch.completed_at = null;
      }

      const updated = await updateVirtualRow<VirtualShippingRow>(supabase, VIRTUAL_TABLE, auth.userId, params.id, patch);
      if (!updated) return NextResponse.json({ error: "Plan bulunamadı" }, { status: 404 });

      if (parsed.data.status === "completed") {
        await supabase
          .from("orders")
          .update({ status: "shipped" })
          .eq("id", virtualBefore.order_id)
          .in("status", ["ready", "confirmed", "in_production"]);
      }

      return NextResponse.json(updated);
    }
    return NextResponse.json({ error: beforeError?.message || "Plan bulunamadı" }, { status: 404 });
  }

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
  if (!before) {
    const deleted = await deleteVirtualRow<VirtualShippingRow>(supabase, VIRTUAL_TABLE, auth.userId, params.id);
    if (!deleted) return NextResponse.json({ error: "Plan bulunamadı" }, { status: 404 });
    return NextResponse.json({ success: true });
  }

  const { error } = await supabase.from("shipping_schedules").delete().eq("id", params.id);
  if (error && isMissingTableError(error, "shipping_schedules")) {
    const deleted = await deleteVirtualRow<VirtualShippingRow>(supabase, VIRTUAL_TABLE, auth.userId, params.id);
    if (!deleted) return NextResponse.json({ error: "Plan bulunamadı" }, { status: 404 });
    return NextResponse.json({ success: true });
  }
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
