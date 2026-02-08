import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("order_id");
  const status = searchParams.get("status");
  const cuttingPlanId = searchParams.get("cutting_plan_id");

  const supabase = createAdminClient();
  let query = supabase
    .from("production_bobins")
    .select(`
      *,
      order:orders!inner(id, order_no, customer, product_type, micron, width, quantity, unit),
      cutting_plan:cutting_plans(id, source_product, target_width),
      entered_by_profile:profiles!production_bobins_entered_by_fkey(full_name),
      warehouse_in_by_profile:profiles!production_bobins_warehouse_in_by_fkey(full_name)
    `)
    .order("entered_at", { ascending: false });

  if (orderId) query = query.eq("order_id", orderId);
  if (cuttingPlanId) query = query.eq("cutting_plan_id", cuttingPlanId);
  if (status && status !== "all") query = query.eq("status", status);

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
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validation
  if (!body.order_id || !body.bobbin_no || !body.meter || !body.kg) {
    return NextResponse.json(
      { error: "order_id, bobbin_no, meter, kg zorunlu" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Get order info for automatic fields
  const { data: order } = await supabase
    .from("orders")
    .select("product_type, micron, width")
    .eq("id", body.order_id)
    .single();

  const bobinData = {
    order_id: body.order_id,
    cutting_plan_id: body.cutting_plan_id || null,
    bobbin_no: body.bobbin_no,
    meter: Number(body.meter),
    kg: Number(body.kg),
    fire_kg: body.fire_kg ? Number(body.fire_kg) : 0,
    product_type: order?.product_type || "",
    micron: order?.micron,
    width: order?.width,
    status: "produced",
    notes: body.notes || null,
    entered_by: auth.userId,
  };

  const { data, error } = await supabase
    .from("production_bobins")
    .insert(bobinData)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
