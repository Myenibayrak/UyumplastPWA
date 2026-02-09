import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { PRODUCTION_READY_STATUSES, isProductionReadyStatus } from "@/lib/production-ready";
import { calculateReadyMetrics, deriveOrderStatusFromReady } from "@/lib/order-ready";
import { isMissingRelationshipError, isMissingTableError } from "@/lib/supabase/postgrest-errors";

type BobinBase = {
  id: string;
  order_id: string;
  cutting_plan_id: string | null;
  entered_by: string | null;
  warehouse_in_by: string | null;
} & Record<string, unknown>;

type CuttingEntryRow = {
  id: string;
  order_id: string;
  cutting_plan_id: string;
  bobbin_label: string;
  cut_kg: number;
  notes: string | null;
  entered_by: string | null;
  created_at: string;
};

async function enrichSingleBobin(supabase: ReturnType<typeof createAdminClient>, row: BobinBase) {
  const [orderRes, planRes, enteredByRes, warehouseByRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_no, customer, product_type, micron, width, quantity, unit")
      .eq("id", row.order_id)
      .maybeSingle(),
    row.cutting_plan_id
      ? supabase
          .from("cutting_plans")
          .select("id, source_product, target_width")
          .eq("id", row.cutting_plan_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    row.entered_by
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .eq("id", row.entered_by)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    row.warehouse_in_by
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .eq("id", row.warehouse_in_by)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return {
    ...row,
    order: orderRes.data ?? null,
    cutting_plan: planRes.data ?? null,
    entered_by_profile: enteredByRes.data ?? null,
    warehouse_in_by_profile: warehouseByRes.data ?? null,
  };
}

async function recalculateProductionReadyKg(supabase: ReturnType<typeof createAdminClient>, orderId: string) {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, quantity, status, source_type, stock_ready_kg")
    .eq("id", orderId)
    .single();
  if (orderError || !order) return;

  const { data: rows } = await supabase
    .from("production_bobins")
    .select("kg")
    .eq("order_id", orderId)
    .in("status", [...PRODUCTION_READY_STATUSES]);

  const totalKg = (rows ?? []).reduce((sum: number, r: { kg: number }) => sum + Number(r.kg || 0), 0);
  const metrics = calculateReadyMetrics(order.quantity, order.stock_ready_kg, totalKg);
  const nextStatus = deriveOrderStatusFromReady(order.status, order.source_type, metrics.isReady);

  const updateData: Record<string, unknown> = { production_ready_kg: totalKg };
  if (nextStatus && nextStatus !== order.status) {
    updateData.status = nextStatus;
  }

  await supabase.from("orders").update(updateData).eq("id", orderId);
}

async function recalculateProductionReadyKgFromCuttingEntries(supabase: ReturnType<typeof createAdminClient>, orderId: string) {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, quantity, status, source_type, stock_ready_kg")
    .eq("id", orderId)
    .single();
  if (orderError || !order) return;

  const { data: rows } = await supabase
    .from("cutting_entries")
    .select("cut_kg")
    .eq("order_id", orderId)
    .eq("is_order_piece", true);

  const totalKg = (rows ?? []).reduce((sum: number, r: { cut_kg: number }) => sum + Number(r.cut_kg || 0), 0);
  const metrics = calculateReadyMetrics(order.quantity, order.stock_ready_kg, totalKg);
  const nextStatus = deriveOrderStatusFromReady(order.status, order.source_type, metrics.isReady);

  const updateData: Record<string, unknown> = { production_ready_kg: totalKg };
  if (nextStatus && nextStatus !== order.status) {
    updateData.status = nextStatus;
  }

  await supabase.from("orders").update(updateData).eq("id", orderId);
}

async function getFallbackBobinFromEntry(
  supabase: ReturnType<typeof createAdminClient>,
  id: string
): Promise<Record<string, unknown> | null> {
  const { data: entry, error } = await supabase
    .from("cutting_entries")
    .select("id, order_id, cutting_plan_id, bobbin_label, cut_kg, notes, entered_by, created_at")
    .eq("id", id)
    .eq("is_order_piece", true)
    .maybeSingle();
  if (error || !entry) return null;

  const row = entry as CuttingEntryRow;
  const [orderRes, planRes, profileRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_no, customer, product_type, micron, width, quantity, unit")
      .eq("id", row.order_id)
      .maybeSingle(),
    supabase
      .from("cutting_plans")
      .select("id, source_product, target_width")
      .eq("id", row.cutting_plan_id)
      .maybeSingle(),
    row.entered_by
      ? supabase.from("profiles").select("id, full_name").eq("id", row.entered_by).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return {
    id: row.id,
    order_id: row.order_id,
    cutting_plan_id: row.cutting_plan_id,
    bobbin_no: row.bobbin_label,
    meter: 0,
    kg: Number(row.cut_kg || 0),
    fire_kg: 0,
    product_type: orderRes.data?.product_type || "",
    micron: orderRes.data?.micron ?? null,
    width: orderRes.data?.width ?? null,
    status: "produced",
    notes: row.notes,
    entered_by: row.entered_by,
    entered_at: row.created_at,
    warehouse_in_at: null,
    warehouse_in_by: null,
    created_at: row.created_at,
    updated_at: row.created_at,
    order: orderRes.data ?? null,
    cutting_plan: planRes.data ?? null,
    entered_by_profile: profileRes.data ?? null,
    warehouse_in_by_profile: null,
  };
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

  if (error) {
    if (isMissingTableError(error, "production_bobins")) {
      const fallback = await getFallbackBobinFromEntry(supabase, params.id);
      if (!fallback) return NextResponse.json({ error: "Bobin kaydı bulunamadı" }, { status: 404 });
      return NextResponse.json(fallback);
    }
    if (
      isMissingRelationshipError(error, "production_bobins", "profiles")
      || isMissingRelationshipError(error, "production_bobins", "orders")
      || isMissingRelationshipError(error, "production_bobins", "cutting_plans")
    ) {
      const retry = await supabase
        .from("production_bobins")
        .select("*")
        .eq("id", params.id)
        .single();
      if (retry.error || !retry.data) {
        return NextResponse.json({ error: retry.error?.message || "Bobin kaydı bulunamadı" }, { status: 404 });
      }
      const enriched = await enrichSingleBobin(supabase, retry.data as BobinBase);
      return NextResponse.json(enriched);
    }
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
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

  const updateData: Record<string, unknown> = {};
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

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "Geçerli alan gönderilmedi" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: before, error: beforeError } = await supabase
    .from("production_bobins")
    .select("*")
    .eq("id", params.id)
    .single();

  if (beforeError && isMissingTableError(beforeError, "production_bobins")) {
    const fallbackBefore = await getFallbackBobinFromEntry(supabase, params.id);
    if (!fallbackBefore) return NextResponse.json({ error: "Bobin kaydı bulunamadı" }, { status: 404 });

    if ("notes" in updateData) {
      const { error: cutUpdateError } = await supabase
        .from("cutting_entries")
        .update({ notes: updateData.notes })
        .eq("id", params.id);
      if (cutUpdateError) return NextResponse.json({ error: cutUpdateError.message }, { status: 500 });
    }

    await recalculateProductionReadyKgFromCuttingEntries(supabase, String(fallbackBefore.order_id));
    const refreshed = await getFallbackBobinFromEntry(supabase, params.id);
    if (!refreshed) return NextResponse.json({ error: "Bobin kaydı bulunamadı" }, { status: 404 });
    return NextResponse.json({ ...refreshed, status: requestedStatus || refreshed.status });
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
  const { data: row, error: rowError } = await supabase
    .from("production_bobins")
    .select("*")
    .eq("id", params.id)
    .single();

  if (rowError && isMissingTableError(rowError, "production_bobins")) {
    const fallback = await getFallbackBobinFromEntry(supabase, params.id);
    if (!fallback) return NextResponse.json({ error: "Bobin kaydı bulunamadı" }, { status: 404 });

    const { error: deleteEntryError } = await supabase.from("cutting_entries").delete().eq("id", params.id);
    if (deleteEntryError) return NextResponse.json({ error: deleteEntryError.message }, { status: 500 });

    await recalculateProductionReadyKgFromCuttingEntries(supabase, String(fallback.order_id));
    return NextResponse.json({ success: true });
  }

  if (!row) {
    return NextResponse.json({ error: "Bobin kaydı bulunamadı" }, { status: 404 });
  }

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "DELETE",
    table_name: "production_bobins",
    record_id: params.id,
    old_data: row,
    new_data: null,
  });

  const { error } = await supabase.from("production_bobins").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalculateProductionReadyKg(supabase, row.order_id);

  return NextResponse.json({ success: true });
}
