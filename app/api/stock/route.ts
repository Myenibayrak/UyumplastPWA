import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { stockCreateSchema } from "@/lib/validations";
import { canCreateStock, canViewStock } from "@/lib/rbac";
import { isMissingTableError } from "@/lib/supabase/postgrest-errors";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewStock(auth.role, auth.fullName)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") || "film";
  const product = searchParams.get("product");

  const supabase = createAdminClient();
  let query = supabase
    .from("stock_items")
    .select("*")
    .eq("category", category)
    .order("product")
    .order("micron")
    .order("width");

  if (product) query = query.eq("product", product);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error, "stock_items")) return NextResponse.json([]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const canCreate = canCreateStock(auth.role);
  if (!canCreate) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const incomingRows = Array.isArray(body) ? body : [body];
  if (incomingRows.length === 0) {
    return NextResponse.json({ error: "En az bir satır gönderilmeli" }, { status: 400 });
  }

  const validatedRows: Array<Record<string, unknown>> = [];
  const rowErrors: Array<{ index: number; error: unknown }> = [];
  incomingRows.forEach((row, idx) => {
    const parsed = stockCreateSchema.safeParse(row);
    if (!parsed.success) {
      rowErrors.push({ index: idx, error: parsed.error.flatten() });
      return;
    }
    validatedRows.push(parsed.data as unknown as Record<string, unknown>);
  });
  if (rowErrors.length > 0) {
    return NextResponse.json({ error: "Bazı satırlar geçersiz", details: rowErrors }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("stock_items")
    .insert(validatedRows)
    .select()
    ;

  if (error && isMissingTableError(error, "stock_items")) {
    return NextResponse.json(
      { error: "Stok altyapısı hazır değil. Veritabanı kurulumunu tamamlayın." },
      { status: 503 }
    );
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const createdRows = data ?? [];
  if (createdRows.length === 0) {
    return NextResponse.json({ error: "Kayıt oluşturulamadı" }, { status: 500 });
  }

  const { error: movementError } = await supabase.from("stock_movements").insert(
    createdRows.map((row) => ({
      stock_item_id: row.id as string,
      movement_type: "in",
      kg: Number(row.kg || 0),
      quantity: Number(row.quantity || 0),
      reason: "stock_item_created",
      reference_type: "stock_item",
      reference_id: row.id as string,
      notes: "Yeni stok kartı oluşturuldu",
      created_by: auth.userId,
    }))
  );
  if (movementError) {
    return NextResponse.json({ error: movementError.message }, { status: 500 });
  }

  const { error: auditError } = await supabase.from("audit_logs").insert(
    createdRows.map((row) => ({
      user_id: auth.userId,
      action: "INSERT",
      table_name: "stock_items",
      record_id: row.id as string,
      old_data: null,
      new_data: row,
    }))
  );
  if (auditError) {
    return NextResponse.json({ error: auditError.message }, { status: 500 });
  }

  return NextResponse.json(Array.isArray(body) ? createdRows : createdRows[0], { status: 201 });
}
