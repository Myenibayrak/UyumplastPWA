import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { stockUpdateSchema } from "@/lib/validations";
import { canViewStock } from "@/lib/rbac";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewStock(auth.role, auth.fullName) || (auth.role !== "admin" && auth.role !== "warehouse")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = stockUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createServerSupabase();
  const { data: before } = await supabase
    .from("stock_items")
    .select("*")
    .eq("id", params.id)
    .single();

  const { data, error } = await supabase
    .from("stock_items")
    .update(parsed.data)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (before && data) {
    const beforeKg = Number(before.kg || 0);
    const afterKg = Number(data.kg || 0);
    const beforeQty = Number(before.quantity || 0);
    const afterQty = Number(data.quantity || 0);
    const diffKg = afterKg - beforeKg;
    const diffQty = afterQty - beforeQty;

    if (diffKg !== 0 || diffQty !== 0) {
      await supabase.from("stock_movements").insert({
        stock_item_id: params.id,
        movement_type: diffKg >= 0 ? "in" : "out",
        kg: Math.abs(diffKg),
        quantity: Math.abs(diffQty),
        reason: "manual_adjustment",
        reference_type: "stock_item",
        reference_id: params.id,
        notes: `Manuel düzeltme: kg ${beforeKg}→${afterKg}, adet ${beforeQty}→${afterQty}`,
        created_by: auth.userId,
      });
    }

    await supabase.from("audit_logs").insert({
      user_id: auth.userId,
      action: "UPDATE",
      table_name: "stock_items",
      record_id: params.id,
      old_data: before,
      new_data: data,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewStock(auth.role, auth.fullName) || (auth.role !== "admin" && auth.role !== "warehouse")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createServerSupabase();
  const { data: existing } = await supabase
    .from("stock_items")
    .select("*")
    .eq("id", params.id)
    .single();

  if (existing) {
    await supabase.from("stock_movements").insert({
      stock_item_id: params.id,
      movement_type: "out",
      kg: Number(existing.kg || 0),
      quantity: Number(existing.quantity || 0),
      reason: "stock_item_deleted",
      reference_type: "stock_item",
      reference_id: params.id,
      notes: "Stok kartı silindi",
      created_by: auth.userId,
    });
    await supabase.from("audit_logs").insert({
      user_id: auth.userId,
      action: "DELETE",
      table_name: "stock_items",
      record_id: params.id,
      old_data: existing,
      new_data: null,
    });
  }

  const { error } = await supabase.from("stock_items").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
