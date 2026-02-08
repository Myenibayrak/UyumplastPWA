import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";
import { PRODUCTION_READY_STATUSES } from "@/lib/production-ready";

async function recalculateProductionReadyKg(supabase: ReturnType<typeof createAdminClient>, orderId: string) {
  const { data: rows } = await supabase
    .from("production_bobins")
    .select("kg")
    .eq("order_id", orderId)
    .in("status", [...PRODUCTION_READY_STATUSES]);

  const totalKg = (rows ?? []).reduce((sum: number, r: { kg: number }) => sum + Number(r.kg || 0), 0);
  await supabase.from("orders").update({ production_ready_kg: totalKg }).eq("id", orderId);
}

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
  const meter = Number(body.meter);
  const kg = Number(body.kg);
  if (!Number.isFinite(meter) || meter <= 0 || !Number.isFinite(kg) || kg <= 0) {
    return NextResponse.json({ error: "meter ve kg pozitif sayı olmalı" }, { status: 400 });
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
    meter,
    kg,
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

  // Trigger olmayan ortamlarda da tutarlılık için toplamı API'de garanti et.
  await recalculateProductionReadyKg(supabase, body.order_id as string);

  // Şeffaflık için işlem geçmişi (audit) tut.
  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "production_bobins",
    record_id: data.id,
    old_data: null,
    new_data: data,
  });

  return NextResponse.json(data, { status: 201 });
}
