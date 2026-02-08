import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";
import { cuttingPlanCreateSchema } from "@/lib/validations";

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

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = cuttingPlanCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();

  const planData = {
    order_id: parsed.data.order_id,
    source_stock_id: parsed.data.source_stock_id ?? null,
    source_product: parsed.data.source_product,
    source_micron: parsed.data.source_micron ?? null,
    source_width: parsed.data.source_width ?? null,
    source_kg: parsed.data.source_kg ?? null,
    target_width: parsed.data.target_width ?? null,
    target_kg: parsed.data.target_kg ?? null,
    target_quantity: parsed.data.target_quantity ?? 1,
    assigned_to: parsed.data.assigned_to ?? null,
    planned_by: auth.userId,
    notes: parsed.data.notes ?? null,
  };

  const { data, error } = await supabase
    .from("cutting_plans")
    .insert(planData)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update order status to in_production.
  const { error: orderUpdateError } = await supabase
    .from("orders")
    .update({
      status: "in_production",
    })
    .eq("id", parsed.data.order_id);
  if (orderUpdateError) return NextResponse.json({ error: orderUpdateError.message }, { status: 500 });

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "cutting_plans",
    record_id: data.id,
    old_data: null,
    new_data: data,
  });

  // Notify assigned operator
  if (planData.assigned_to) {
    const orderRes = await supabase.from("orders").select("order_no, customer").eq("id", parsed.data.order_id).single();
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
