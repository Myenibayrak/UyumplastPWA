import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canViewStock } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewStock(auth.role, auth.fullName)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const limitRaw = Number(searchParams.get("limit") || 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500) : 100;

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("stock_movements")
    .select(`
      *,
      stock_item:stock_items(id, category, product, micron, width, lot_no),
      creator:profiles!stock_movements_created_by_fkey(full_name, role)
    `)
    .order("created_at", { ascending: false })
    .limit(limit * 2);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = data ?? [];
  if (category) {
    rows = rows.filter((row: { stock_item?: { category?: string } | null }) => row.stock_item?.category === category);
  }

  return NextResponse.json(rows.slice(0, limit));
}
