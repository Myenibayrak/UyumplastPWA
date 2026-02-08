import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";

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

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const updateData: Record<string, unknown> = {};

  // Production can update status, notes
  if (auth.role === "production" || auth.role === "admin") {
    if ("status" in body) updateData.status = body.status;
    if ("notes" in body) updateData.notes = body.notes;
  }

  // Warehouse can update status to 'warehouse', warehouse_in_at, warehouse_in_by
  if (auth.role === "warehouse" || auth.role === "admin") {
    if (body.status === "warehouse") {
      updateData.status = "warehouse";
      updateData.warehouse_in_at = new Date().toISOString();
      updateData.warehouse_in_by = auth.userId;
    }
  }

  const { data, error } = await supabase
    .from("production_bobins")
    .update(updateData)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("production_bobins").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
