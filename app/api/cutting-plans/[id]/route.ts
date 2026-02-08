import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("cutting_plans")
    .select(`
      *,
      order:orders!inner(id, order_no, customer, product_type, micron, width, quantity, unit, trim_width, ship_date, priority, status),
      assignee:profiles!cutting_plans_assigned_to_fkey(id, full_name, role),
      planner:profiles!cutting_plans_planned_by_fkey(id, full_name, role),
      entries:cutting_entries(*, entered_by_profile:profiles!cutting_entries_entered_by_fkey(full_name))
    `)
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, ["admin", "production"]);
  if (roleCheck) return roleCheck;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const supabase = createServerSupabase();

  const updateData: Record<string, unknown> = {};
  const allowed = ["status", "assigned_to", "source_stock_id", "source_product", "source_micron", "source_width", "source_kg", "target_width", "target_kg", "target_quantity", "notes"];
  for (const key of allowed) {
    if (key in body) updateData[key] = body[key];
  }

  const { data, error } = await supabase
    .from("cutting_plans")
    .update(updateData)
    .eq("id", params.id)
    .select("*, order:orders!inner(id, order_no, customer, created_by)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // On status change, send notifications
  if (body.status === "completed") {
    const order = data.order as { id: string; order_no: string; customer: string; created_by: string };

    // Update order ready_quantity from cutting entries
    const { data: entries } = await supabase
      .from("cutting_entries")
      .select("cut_kg, is_order_piece")
      .eq("cutting_plan_id", params.id)
      .eq("is_order_piece", true);

    const totalCutKg = (entries ?? []).reduce((s: number, e: { cut_kg: number }) => s + e.cut_kg, 0);
    await supabase.from("orders").update({ ready_quantity: totalCutKg, status: "ready" }).eq("id", order.id);

    // Notify order creator (sales)
    await supabase.from("notifications").insert({
      user_id: order.created_by,
      title: "Kesim Tamamlandı",
      body: `${order.order_no} - ${order.customer} siparişinin kesimi tamamlandı. Hazır: ${totalCutKg} kg`,
      type: "cutting_complete",
      ref_id: order.id,
    });

    // Notify all warehouse users
    const { data: warehouseUsers } = await supabase.from("profiles").select("id").eq("role", "warehouse");
    if (warehouseUsers) {
      const notifications = warehouseUsers.map((u: { id: string }) => ({
        user_id: u.id,
        title: "Mal Hazır - Depoya Alın",
        body: `${order.order_no} - ${order.customer} kesimi bitti, ${totalCutKg} kg hazır.`,
        type: "cutting_complete",
        ref_id: order.id,
      }));
      if (notifications.length > 0) await supabase.from("notifications").insert(notifications);
    }

    // Notify shipping
    const { data: shippingUsers } = await supabase.from("profiles").select("id").eq("role", "shipping");
    if (shippingUsers) {
      const notifications = shippingUsers.map((u: { id: string }) => ({
        user_id: u.id,
        title: "Sevkiyat Hazır",
        body: `${order.order_no} - ${order.customer} kesimi bitti, sevk edilebilir.`,
        type: "cutting_complete",
        ref_id: order.id,
      }));
      if (notifications.length > 0) await supabase.from("notifications").insert(notifications);
    }
  }

  if (body.status === "in_progress" && data.order) {
    const order = data.order as { id: string; order_no: string; customer: string; created_by: string };
    await supabase.from("notifications").insert({
      user_id: order.created_by,
      title: "Kesim Başladı",
      body: `${order.order_no} - ${order.customer} siparişinin kesimi başladı.`,
      type: "cutting_started",
      ref_id: order.id,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, ["admin"]);
  if (roleCheck) return roleCheck;

  const supabase = createServerSupabase();
  const { error } = await supabase.from("cutting_plans").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
