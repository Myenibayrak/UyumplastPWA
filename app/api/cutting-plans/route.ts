import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const assignedTo = searchParams.get("assigned_to");

  const supabase = createAdminClient();
  let query = supabase
    .from("cutting_plans")
    .select(`
      *,
      order:orders!inner(id, order_no, customer, product_type, micron, width, quantity, unit, trim_width, ship_date, priority, status),
      assignee:profiles!cutting_plans_assigned_to_fkey(id, full_name, role),
      planner:profiles!cutting_plans_planned_by_fkey(id, full_name, role),
      entries:cutting_entries(*)
    `)
    .order("created_at", { ascending: false });

  if (status && status !== "all") query = query.eq("status", status);
  if (assignedTo) query = query.eq("assigned_to", assignedTo);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, ["admin", "production"]);
  if (roleCheck) return roleCheck;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const supabase = createAdminClient();

  const planData = {
    order_id: body.order_id,
    source_stock_id: body.source_stock_id || null,
    source_product: body.source_product,
    source_micron: body.source_micron || null,
    source_width: body.source_width || null,
    source_kg: body.source_kg || null,
    target_width: body.target_width || null,
    target_kg: body.target_kg || null,
    target_quantity: body.target_quantity || 1,
    assigned_to: body.assigned_to || null,
    planned_by: auth.userId,
    notes: body.notes || null,
  };

  const { data, error } = await supabase
    .from("cutting_plans")
    .insert(planData)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Deduct from source stock when plan is created
  if (body.source_stock_id && body.source_kg) {
    const { data: sourceStock } = await supabase
      .from("stock_items")
      .select("kg, quantity")
      .eq("id", body.source_stock_id)
      .single();

    if (sourceStock) {
      const deductKg = Number(body.source_kg);
      const newKg = Math.max(0, sourceStock.kg - deductKg);
      const newQty = newKg <= 0 ? 0 : sourceStock.quantity;
      await supabase
        .from("stock_items")
        .update({ kg: newKg, quantity: newQty })
        .eq("id", body.source_stock_id);

      // Log stock movement
      await supabase.from("stock_movements").insert({
        stock_item_id: body.source_stock_id,
        movement_type: "out",
        kg: deductKg,
        quantity: 0,
        reason: "cutting_plan_reserved",
        reference_type: "cutting_plan",
        reference_id: data.id,
        notes: `Kesim planı: ${body.source_product}`,
        created_by: auth.userId,
      });
    }
  }

  // Update order status to in_production.
  const { error: orderUpdateError } = await supabase
    .from("orders")
    .update({
      status: "in_production",
    })
    .eq("id", body.order_id);
  if (orderUpdateError) return NextResponse.json({ error: orderUpdateError.message }, { status: 500 });

  // Notify assigned operator
  if (planData.assigned_to) {
    const orderRes = await supabase.from("orders").select("order_no, customer").eq("id", body.order_id).single();
    const order = orderRes.data;
    if (order) {
      await supabase.from("notifications").insert({
        user_id: planData.assigned_to,
        title: "Yeni Kesim Planı",
        body: `${order.order_no} - ${order.customer} siparişi için kesim planı atandı.`,
        type: "task_assigned",
        ref_id: data.id,
      });
    }
  }

  return NextResponse.json(data, { status: 201 });
}
