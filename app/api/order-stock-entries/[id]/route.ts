import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.role !== "warehouse" && auth.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();

  // Get entry before deleting to update order stock_ready_kg
  const { data: entry } = await supabase
    .from("order_stock_entries")
    .select("order_id, kg")
    .eq("id", params.id)
    .single();

  if (entry) {
    // Delete the entry
    const { error } = await supabase.from("order_stock_entries").delete().eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Recalculate stock_ready_kg for the order
    const { data: remainingEntries } = await supabase
      .from("order_stock_entries")
      .select("kg")
      .eq("order_id", entry.order_id);

    const totalKg = (remainingEntries ?? []).reduce((sum: number, e: { kg: number }) => sum + e.kg, 0);

    await supabase
      .from("orders")
      .update({ stock_ready_kg: totalKg })
      .eq("id", entry.order_id);
  }

  return NextResponse.json({ success: true });
}
