import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { stockCreateSchema } from "@/lib/validations";
import { canViewStock } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewStock(auth.role, auth.fullName)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") || "film";
  const product = searchParams.get("product");

  const supabase = createServerSupabase();
  let query = supabase
    .from("stock_items")
    .select("*")
    .eq("category", category)
    .order("product")
    .order("micron")
    .order("width");

  if (product) query = query.eq("product", product);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewStock(auth.role, auth.fullName) || (auth.role !== "admin" && auth.role !== "warehouse")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = stockCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("stock_items")
    .insert(parsed.data)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("stock_movements").insert({
    stock_item_id: data.id,
    movement_type: "in",
    kg: Number(data.kg || 0),
    quantity: Number(data.quantity || 0),
    reason: "stock_item_created",
    reference_type: "stock_item",
    reference_id: data.id,
    notes: "Yeni stok kartı oluşturuldu",
    created_by: auth.userId,
  });

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "stock_items",
    record_id: data.id,
    old_data: null,
    new_data: data,
  });

  return NextResponse.json(data, { status: 201 });
}
