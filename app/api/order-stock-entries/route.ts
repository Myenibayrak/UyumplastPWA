import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canUseWarehouseEntry } from "@/lib/rbac";
import { calculateReadyMetrics, deriveOrderStatusFromReady } from "@/lib/order-ready";

async function recalculateStockReadyKgAndStatus(supabase: ReturnType<typeof createAdminClient>, orderId: string) {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, quantity, status, source_type, production_ready_kg")
    .eq("id", orderId)
    .single();
  if (orderError || !order) return { error: orderError?.message || "Sipariş bulunamadı" };

  const { data: allEntries, error: entriesError } = await supabase
    .from("order_stock_entries")
    .select("kg")
    .eq("order_id", orderId);
  if (entriesError) return { error: entriesError.message };

  const totalStockKg = (allEntries ?? []).reduce((sum: number, e: { kg: number }) => sum + Number(e.kg || 0), 0);
  const metrics = calculateReadyMetrics(order.quantity, totalStockKg, order.production_ready_kg);
  const nextStatus = deriveOrderStatusFromReady(order.status, order.source_type, metrics.isReady);

  const updateData: Record<string, unknown> = { stock_ready_kg: totalStockKg };
  if (nextStatus && nextStatus !== order.status) {
    updateData.status = nextStatus;
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", orderId);
  if (updateError) return { error: updateError.message };

  return { totalStockKg };
}

export async function GET(
  request: NextRequest
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canUseWarehouseEntry(auth.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("order_id");
  if (!orderId) {
    return NextResponse.json({ error: "order_id gerekli" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("order_stock_entries")
    .select(`
      *,
      entered_by_profile:profiles!order_stock_entries_entered_by_fkey(full_name)
    `)
    .eq("order_id", orderId)
    .order("entered_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (!canUseWarehouseEntry(auth.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.order_id || !body.bobbin_label || !body.kg) {
    return NextResponse.json(
      { error: "order_id, bobbin_label, kg zorunlu" },
      { status: 400 }
    );
  }
  const kg = Number(body.kg);
  if (!Number.isFinite(kg) || kg <= 0) {
    return NextResponse.json({ error: "kg pozitif bir sayı olmalı" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, source_type")
    .eq("id", body.order_id)
    .single();
  if (orderError || !order) {
    return NextResponse.json({ error: orderError?.message || "Sipariş bulunamadı" }, { status: 404 });
  }
  if (order.source_type === "production") {
    return NextResponse.json({ error: "Bu sipariş sadece üretim kaynağından hazırlanır" }, { status: 400 });
  }
  if (["shipped", "delivered", "cancelled", "closed"].includes(String(order.status))) {
    return NextResponse.json({ error: "Bu siparişe depo girişi yapılamaz" }, { status: 400 });
  }

  const entryData = {
    order_id: body.order_id,
    bobbin_label: body.bobbin_label,
    kg,
    notes: body.notes || null,
    entered_by: auth.userId,
  };

  const { data, error } = await supabase
    .from("order_stock_entries")
    .insert(entryData)
    .select(`
      *,
      entered_by_profile:profiles!order_stock_entries_entered_by_fkey(full_name)
    `)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Trigger olmayan ortamlarda da tutarlılık için toplamı ve sipariş durumunu API'de garanti et.
  const recalc = await recalculateStockReadyKgAndStatus(supabase, entryData.order_id as string);
  if ("error" in recalc) {
    await supabase.from("order_stock_entries").delete().eq("id", data.id);
    return NextResponse.json({ error: recalc.error }, { status: 500 });
  }

  const { error: auditError } = await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "order_stock_entries",
    record_id: data.id,
    old_data: null,
    new_data: data,
  });

  if (auditError) {
    return NextResponse.json(
      { ...data, warnings: [`Audit kaydı yazılamadı: ${auditError.message}`] },
      { status: 201 }
    );
  }

  return NextResponse.json({ ...data, warnings: [] }, { status: 201 });
}
