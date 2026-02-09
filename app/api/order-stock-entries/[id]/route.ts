import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canUseWarehouseEntry } from "@/lib/rbac";
import { calculateReadyMetrics, deriveOrderStatusFromReady } from "@/lib/order-ready";
import { isMissingTableError } from "@/lib/supabase/postgrest-errors";
import { deleteVirtualRow, listVirtualRows } from "@/lib/virtual-store";

type VirtualOrderStockEntry = {
  id: string;
  order_id: string;
  bobbin_label: string;
  kg: number;
  notes: string | null;
  entered_by: string;
  entered_at: string;
  created_at: string;
  updated_at: string;
};

const VIRTUAL_TABLE = "virtual_order_stock_entries";

async function recalculateStockReadyKgAndStatus(supabase: ReturnType<typeof createAdminClient>, orderId: string) {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, quantity, status, source_type, production_ready_kg")
    .eq("id", orderId)
    .single();
  if (orderError || !order) return { error: orderError?.message || "Sipariş bulunamadı" };

  const { data: remainingEntries, error: entriesError } = await supabase
    .from("order_stock_entries")
    .select("kg")
    .eq("order_id", orderId);
  if (entriesError) return { error: entriesError.message };

  const totalStockKg = (remainingEntries ?? []).reduce((sum: number, e: { kg: number }) => sum + Number(e.kg || 0), 0);
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

async function recalculateVirtualStockReadyKgAndStatus(supabase: ReturnType<typeof createAdminClient>, orderId: string) {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, quantity, status, source_type, production_ready_kg")
    .eq("id", orderId)
    .single();
  if (orderError || !order) return { error: orderError?.message || "Sipariş bulunamadı" };

  const remainingEntries = await listVirtualRows<VirtualOrderStockEntry>(supabase, VIRTUAL_TABLE, {
    eq: { order_id: orderId },
    limit: 15000,
  });
  const totalStockKg = remainingEntries.reduce((sum: number, e) => sum + Number(e.kg || 0), 0);
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

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (!canUseWarehouseEntry(auth.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();

  // Get entry before deleting to update order stock_ready_kg
  const { data: entry, error: entryError } = await supabase
    .from("order_stock_entries")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!entry) {
    if (isMissingTableError(entryError, "order_stock_entries")) {
      const deletedVirtual = await deleteVirtualRow<VirtualOrderStockEntry>(supabase, VIRTUAL_TABLE, auth.userId, params.id);
      if (!deletedVirtual) return NextResponse.json({ error: "Kayıt bulunamadı" }, { status: 404 });

      const recalcVirtual = await recalculateVirtualStockReadyKgAndStatus(supabase, deletedVirtual.order_id);
      if ("error" in recalcVirtual) return NextResponse.json({ error: recalcVirtual.error }, { status: 500 });

      return NextResponse.json({ success: true, warnings: [] });
    }
    return NextResponse.json({ error: "Kayıt bulunamadı" }, { status: 404 });
  }

  // Delete the entry
  const { error } = await supabase.from("order_stock_entries").delete().eq("id", params.id);
  if (error && isMissingTableError(error, "order_stock_entries")) {
    const deletedVirtual = await deleteVirtualRow<VirtualOrderStockEntry>(supabase, VIRTUAL_TABLE, auth.userId, params.id);
    if (!deletedVirtual) return NextResponse.json({ error: "Kayıt bulunamadı" }, { status: 404 });
    const recalcVirtual = await recalculateVirtualStockReadyKgAndStatus(supabase, deletedVirtual.order_id);
    if ("error" in recalcVirtual) return NextResponse.json({ error: recalcVirtual.error }, { status: 500 });
    return NextResponse.json({ success: true, warnings: [] });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Recalculate stock_ready_kg and status for the order
  const recalc = await recalculateStockReadyKgAndStatus(supabase, entry.order_id as string);
  if ("error" in recalc) {
    await supabase.from("order_stock_entries").insert(entry);
    return NextResponse.json({ error: recalc.error }, { status: 500 });
  }

  const { error: auditError } = await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "DELETE",
    table_name: "order_stock_entries",
    record_id: params.id,
    old_data: entry,
    new_data: null,
  });
  if (auditError) {
    return NextResponse.json({ success: true, warnings: [`Audit kaydı yazılamadı: ${auditError.message}`] });
  }

  return NextResponse.json({ success: true, warnings: [] });
}
