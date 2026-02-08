import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { PRODUCTION_READY_STATUSES, isProductionReadyStatus } from "@/lib/production-ready";

async function recalculateProductionReadyKg(supabase: ReturnType<typeof createAdminClient>, orderId: string) {
  const { data: rows } = await supabase
    .from("production_bobins")
    .select("kg")
    .eq("order_id", orderId)
    .in("status", [...PRODUCTION_READY_STATUSES]);

  const totalKg = (rows ?? []).reduce((sum: number, r: { kg: number }) => sum + Number(r.kg || 0), 0);
  await supabase.from("orders").update({ production_ready_kg: totalKg }).eq("id", orderId);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("production_bobins")
    .select(`
      *,
      order:orders!inner(id, order_no, customer, product_type, micron, width, quantity, unit),
      cutting_plan:cutting_plans(id, source_product, target_width),
      entered_by_profile:profiles!production_bobins_entered_by_fkey(full_name),
      warehouse_in_by_profile:profiles!production_bobins_warehouse_in_by_fkey(full_name)
    `)
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (!["admin", "production", "warehouse"].includes(auth.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const requestedStatus = "status" in body ? String(body.status) : null;
  if (requestedStatus && !isProductionReadyStatus(requestedStatus)) {
    return NextResponse.json({ error: "Geçersiz bobin durumu" }, { status: 400 });
  }
  if ("notes" in body && body.notes !== null && typeof body.notes !== "string") {
    return NextResponse.json({ error: "notes metin olmalı" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: before } = await supabase
    .from("production_bobins")
    .select("*")
    .eq("id", params.id)
    .single();

  const updateData: Record<string, unknown> = {};

  // Production can update status, notes
  if (auth.role === "production" || auth.role === "admin") {
    if ("notes" in body) updateData.notes = body.notes;
  }

  if (requestedStatus && auth.role === "production") {
    if (!["produced", "ready"].includes(requestedStatus)) {
      return NextResponse.json({ error: "Üretim rolü bu durumu seçemez" }, { status: 403 });
    }
    updateData.status = requestedStatus;
  }

  if (requestedStatus && auth.role === "admin") {
    updateData.status = requestedStatus;
    if (requestedStatus === "warehouse") {
      updateData.warehouse_in_at = new Date().toISOString();
      updateData.warehouse_in_by = auth.userId;
    }
  }

  // Warehouse can only move bobin to warehouse.
  if (requestedStatus && auth.role === "warehouse") {
    if (requestedStatus !== "warehouse") {
      return NextResponse.json({ error: "Depo rolü sadece depoya alabilir" }, { status: 403 });
    }
    updateData.status = "warehouse";
    updateData.warehouse_in_at = new Date().toISOString();
    updateData.warehouse_in_by = auth.userId;
  }

  if (!requestedStatus && "notes" in body && auth.role === "warehouse") {
    return NextResponse.json({ error: "Depo rolü not güncelleyemez" }, { status: 403 });
  }

  // Production can update notes.
  if ("notes" in body && auth.role === "production") {
    if ("notes" in body) updateData.notes = body.notes;
  }
  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "Geçerli alan gönderilmedi" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("production_bobins")
    .update(updateData)
    .eq("id", params.id)
    .select()
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Güncelleme hatası" }, { status: 500 });

  await recalculateProductionReadyKg(supabase, data.order_id);
  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "UPDATE",
    table_name: "production_bobins",
    record_id: params.id,
    old_data: before ?? null,
    new_data: data,
  });

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("production_bobins")
    .select("*")
    .eq("id", params.id)
    .single();

  if (row) {
    await supabase.from("audit_logs").insert({
      user_id: auth.userId,
      action: "DELETE",
      table_name: "production_bobins",
      record_id: params.id,
      old_data: row,
      new_data: null,
    });
  }

  const { error } = await supabase.from("production_bobins").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (row?.order_id) {
    await recalculateProductionReadyKg(supabase, row.order_id);
  }

  return NextResponse.json({ success: true });
}
