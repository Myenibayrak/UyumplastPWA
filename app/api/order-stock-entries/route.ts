import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";

export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("order_stock_entries")
    .select(`
      *,
      entered_by_profile:profiles!order_stock_entries_entered_by_fkey(full_name)
    `)
    .eq("order_id", params.orderId)
    .order("entered_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.role !== "warehouse" && auth.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.order_id || !body.bobbin_label || !body.kg) {
    return NextResponse.json(
      { error: "order_id, bobbin_label, kg zorunlu" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const entryData = {
    order_id: body.order_id,
    bobbin_label: body.bobbin_label,
    kg: Number(body.kg),
    notes: body.notes || null,
    entered_by: auth.userId,
  };

  const { data, error } = await supabase
    .from("order_stock_entries")
    .insert(entryData)
    .select(`
      *,
      entered_by_profile:profiles!order_stock_entries_entered_by_fkey(full_name)
    `)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
