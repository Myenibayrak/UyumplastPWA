import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";

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

  const supabase = createServerSupabase();

  // Get the cutting plan to find order_id and source info
  const { data: plan, error: planErr } = await supabase
    .from("cutting_plans")
    .select("order_id, source_stock_id, source_product, source_micron")
    .eq("id", body.cutting_plan_id)
    .single();

  if (planErr || !plan) return NextResponse.json({ error: "Kesim planı bulunamadı" }, { status: 404 });

  const entryData = {
    cutting_plan_id: body.cutting_plan_id,
    order_id: plan.order_id,
    source_stock_id: plan.source_stock_id,
    bobbin_label: body.bobbin_label,
    cut_width: Number(body.cut_width),
    cut_kg: Number(body.cut_kg),
    cut_quantity: Number(body.cut_quantity) || 1,
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

  // Deduct from source stock (large bobbin)
  if (plan.source_stock_id) {
    const { data: sourceStock } = await supabase
      .from("stock_items")
      .select("kg, quantity")
      .eq("id", plan.source_stock_id)
      .single();

    if (sourceStock) {
      const newKg = Math.max(0, sourceStock.kg - Number(body.cut_kg));
      const newQty = newKg <= 0 ? 0 : sourceStock.quantity;
      await supabase.from("stock_items").update({ kg: newKg, quantity: newQty }).eq("id", plan.source_stock_id);

      // Log stock movement: OUT from source
      await supabase.from("stock_movements").insert({
        stock_item_id: plan.source_stock_id,
        movement_type: "out",
        kg: Number(body.cut_kg),
        quantity: 0,
        reason: "cutting_source",
        reference_type: "cutting_entry",
        reference_id: entry.id,
        notes: `Kesim: ${body.bobbin_label}`,
        created_by: auth.userId,
      });
    }
  }

  // If it's an order piece, add to order's ready_quantity
  if (entryData.is_order_piece) {
    const { data: orderEntries } = await supabase
      .from("cutting_entries")
      .select("cut_kg")
      .eq("order_id", plan.order_id)
      .eq("is_order_piece", true);

    const totalReady = (orderEntries ?? []).reduce((s: number, e: { cut_kg: number }) => s + e.cut_kg, 0);
    await supabase.from("orders").update({ ready_quantity: totalReady }).eq("id", plan.order_id);
  }

  // If it's a leftover piece (not for order), add to stock
  if (!entryData.is_order_piece) {
    const { data: newStockItem } = await supabase.from("stock_items").insert({
      category: "film",
      product: plan.source_product,
      micron: plan.source_micron,
      width: Number(body.cut_width),
      kg: Number(body.cut_kg),
      quantity: Number(body.cut_quantity) || 1,
      lot_no: body.bobbin_label,
      notes: `Kesim artığı - Sipariş: ${plan.order_id}`,
    }).select().single();

    if (newStockItem) {
      await supabase.from("stock_movements").insert({
        stock_item_id: newStockItem.id,
        movement_type: "in",
        kg: Number(body.cut_kg),
        quantity: Number(body.cut_quantity) || 1,
        reason: "cutting_leftover",
        reference_type: "cutting_entry",
        reference_id: entry.id,
        notes: `Kesim artığı: ${body.bobbin_label}`,
        created_by: auth.userId,
      });
    }
  }

  // Update cutting plan status to in_progress if it's still planned
  await supabase
    .from("cutting_plans")
    .update({ status: "in_progress" })
    .eq("id", body.cutting_plan_id)
    .eq("status", "planned");

  return NextResponse.json(entry, { status: 201 });
}
