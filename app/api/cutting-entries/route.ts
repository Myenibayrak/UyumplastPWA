import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";
import { calculateReadyMetrics, deriveOrderStatusFromReady } from "@/lib/order-ready";

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, ["admin", "production"]);
  if (roleCheck) return roleCheck;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.cutting_plan_id || !body.bobbin_label || !body.cut_width || !body.cut_kg) {
    return NextResponse.json({ error: "cutting_plan_id, bobbin_label, cut_width, cut_kg zorunlu" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Get the cutting plan to find order_id and source info
  const { data: plan, error: planErr } = await supabase
    .from("cutting_plans")
    .select("order_id, source_stock_id, source_product, source_micron")
    .eq("id", body.cutting_plan_id)
    .single();

  if (planErr || !plan) return NextResponse.json({ error: "Kesim planı bulunamadı" }, { status: 404 });

  const cutKg = Number(body.cut_kg);
  if (!Number.isFinite(cutKg) || cutKg <= 0) {
    return NextResponse.json({ error: "cut_kg geçerli bir sayı olmalı" }, { status: 400 });
  }
  const cutWidth = Number(body.cut_width);
  if (!Number.isFinite(cutWidth) || cutWidth <= 0) {
    return NextResponse.json({ error: "cut_width geçerli bir sayı olmalı" }, { status: 400 });
  }
  const cutQuantityRaw = body.cut_quantity == null ? 1 : Number(body.cut_quantity);
  if (!Number.isFinite(cutQuantityRaw) || cutQuantityRaw <= 0) {
    return NextResponse.json({ error: "cut_quantity geçerli bir sayı olmalı" }, { status: 400 });
  }
  const cutQuantity = cutQuantityRaw;

  let sourceStockSnapshot: { kg: number; quantity: number } | null = null;
  if (plan.source_stock_id) {
    const { data: sourceStock, error: sourceStockError } = await supabase
      .from("stock_items")
      .select("kg, quantity")
      .eq("id", plan.source_stock_id)
      .single();
    if (sourceStockError || !sourceStock) {
      return NextResponse.json({ error: "Kaynak stok bobini bulunamadı" }, { status: 404 });
    }
    if (Number(sourceStock.kg || 0) < cutKg) {
      return NextResponse.json(
        { error: `Yetersiz stok: Mevcut ${Number(sourceStock.kg || 0)} kg, istenen ${cutKg} kg` },
        { status: 400 }
      );
    }
    sourceStockSnapshot = { kg: Number(sourceStock.kg || 0), quantity: Number(sourceStock.quantity || 0) };
  }

  const entryData = {
    cutting_plan_id: body.cutting_plan_id,
    order_id: plan.order_id,
    source_stock_id: plan.source_stock_id,
    bobbin_label: body.bobbin_label,
    cut_width: cutWidth,
    cut_kg: cutKg,
    cut_quantity: cutQuantity,
    is_order_piece: body.is_order_piece !== false,
    entered_by: auth.userId,
    machine_no: body.machine_no || null,
    firma: body.firma || null,
    cap: body.cap || null,
    bant: body.bant || null,
    piece_weight: body.piece_weight ? Number(body.piece_weight) : null,
    notes: body.notes || null,
  };

  const { data: entry, error } = await supabase
    .from("cutting_entries")
    .insert(entryData)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const warnings: string[] = [];
  let sourceAdjusted = false;
  let sourceMovementLogged = false;
  let leftoverStockId: string | null = null;
  let leftoverMovementLogged = false;

  const rollbackEntry = async () => {
    if (leftoverMovementLogged) {
      await supabase
        .from("stock_movements")
        .delete()
        .eq("reference_type", "cutting_entry")
        .eq("reference_id", entry.id)
        .eq("reason", "cutting_leftover");
    }

    if (leftoverStockId) {
      await supabase.from("stock_items").delete().eq("id", leftoverStockId);
    }

    if (sourceMovementLogged) {
      await supabase
        .from("stock_movements")
        .delete()
        .eq("reference_type", "cutting_entry")
        .eq("reference_id", entry.id)
        .eq("reason", "cutting_source");
    }

    if (sourceAdjusted && plan.source_stock_id && sourceStockSnapshot) {
      await supabase
        .from("stock_items")
        .update({ kg: sourceStockSnapshot.kg, quantity: sourceStockSnapshot.quantity })
        .eq("id", plan.source_stock_id);
    }

    await supabase.from("cutting_entries").delete().eq("id", entry.id);
  };

  // Deduct from source stock (large bobbin)
  if (plan.source_stock_id && sourceStockSnapshot) {
    const newKg = sourceStockSnapshot.kg - cutKg;
    const newQty = newKg <= 0 ? 0 : sourceStockSnapshot.quantity;
    const { data: updatedSource, error: stockUpdateError } = await supabase
      .from("stock_items")
      .update({ kg: newKg, quantity: newQty })
      .eq("id", plan.source_stock_id)
      .gte("kg", cutKg)
      .select("id")
      .maybeSingle();
    if (stockUpdateError) {
      await rollbackEntry();
      return NextResponse.json({ error: stockUpdateError.message }, { status: 500 });
    }
    if (!updatedSource) {
      await rollbackEntry();
      return NextResponse.json({ error: "Stok miktarı değişti, lütfen tekrar deneyin" }, { status: 409 });
    }
    sourceAdjusted = true;

    // Log stock movement: OUT from source
    const { error: stockOutMovementError } = await supabase.from("stock_movements").insert({
      stock_item_id: plan.source_stock_id,
      movement_type: "out",
      kg: cutKg,
      quantity: 0,
      reason: "cutting_source",
      reference_type: "cutting_entry",
      reference_id: entry.id,
      notes: `Kesim: ${body.bobbin_label}`,
      created_by: auth.userId,
    });
    if (stockOutMovementError) {
      await rollbackEntry();
      return NextResponse.json({ error: stockOutMovementError.message }, { status: 500 });
    }
    sourceMovementLogged = true;
  }

  // If it's an order piece, update order's production_ready_kg and status.
  if (entryData.is_order_piece) {
    const { data: orderEntries, error: orderEntriesError } = await supabase
      .from("cutting_entries")
      .select("cut_kg")
      .eq("order_id", plan.order_id)
      .eq("is_order_piece", true);
    if (orderEntriesError) {
      warnings.push(`Üretim hazır kg hesaplanamadı: ${orderEntriesError.message}`);
    } else {
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("quantity, status, source_type, stock_ready_kg")
        .eq("id", plan.order_id)
        .single();
      if (orderError || !order) {
        warnings.push(`Sipariş hazır durumu güncellenemedi: ${orderError?.message || "Sipariş bulunamadı"}`);
      } else {
        const totalProductionKg = (orderEntries ?? []).reduce((s: number, e: { cut_kg: number }) => s + Number(e.cut_kg || 0), 0);
        const metrics = calculateReadyMetrics(order.quantity, order.stock_ready_kg, totalProductionKg);
        const nextStatus = deriveOrderStatusFromReady(order.status, order.source_type, metrics.isReady);
        const updateData: Record<string, unknown> = { production_ready_kg: totalProductionKg };
        if (nextStatus && nextStatus !== order.status) {
          updateData.status = nextStatus;
        }

        const { error: orderReadyUpdateError } = await supabase
          .from("orders")
          .update(updateData)
          .eq("id", plan.order_id);
        if (orderReadyUpdateError) warnings.push(`production_ready_kg güncellenemedi: ${orderReadyUpdateError.message}`);
      }
    }
  }

  // If it's a leftover piece (not for order), add to stock
  if (!entryData.is_order_piece) {
    const { data: newStockItem, error: newStockItemError } = await supabase.from("stock_items").insert({
      category: "film",
      product: plan.source_product,
      micron: plan.source_micron,
      width: Number(body.cut_width),
      kg: cutKg,
      quantity: cutQuantity,
      lot_no: body.bobbin_label,
      notes: `Kesim artığı - Sipariş: ${plan.order_id}`,
    }).select().single();
    if (newStockItemError || !newStockItem) {
      await rollbackEntry();
      return NextResponse.json({ error: newStockItemError?.message || "Kesim artığı stok kaydı açılamadı" }, { status: 500 });
    }
    leftoverStockId = newStockItem.id;

    const { error: stockInMovementError } = await supabase.from("stock_movements").insert({
      stock_item_id: newStockItem.id,
      movement_type: "in",
      kg: cutKg,
      quantity: cutQuantity,
      reason: "cutting_leftover",
      reference_type: "cutting_entry",
      reference_id: entry.id,
      notes: `Kesim artığı: ${body.bobbin_label}`,
      created_by: auth.userId,
    });
    if (stockInMovementError) {
      await rollbackEntry();
      return NextResponse.json({ error: stockInMovementError.message }, { status: 500 });
    }
    leftoverMovementLogged = true;
  }

  // Update cutting plan status to in_progress if it's still planned
  const { error: planStatusError } = await supabase
    .from("cutting_plans")
    .update({ status: "in_progress" })
    .eq("id", body.cutting_plan_id)
    .eq("status", "planned");
  if (planStatusError) warnings.push(`Plan durumu güncellenemedi: ${planStatusError.message}`);

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "cutting_entries",
    record_id: entry.id,
    old_data: null,
    new_data: entry,
  });

  return NextResponse.json({ ...entry, warnings }, { status: 201 });
}
