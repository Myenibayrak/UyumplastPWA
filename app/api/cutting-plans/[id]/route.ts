import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";
import { cuttingPlanUpdateSchema } from "@/lib/validations";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const supabase = createAdminClient();
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

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = cuttingPlanUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: before } = await supabase
    .from("cutting_plans")
    .select("*")
    .eq("id", params.id)
    .single();

  const { data, error } = await supabase
    .from("cutting_plans")
    .update(parsed.data)
    .eq("id", params.id)
    .select("*, order:orders!inner(id, order_no, customer, created_by)")
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Plan güncellenemedi" }, { status: 500 });

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "UPDATE",
    table_name: "cutting_plans",
    record_id: params.id,
    old_data: before ?? null,
    new_data: data,
  });

  const previousStatus = (before as { status?: string } | null)?.status;
  const nextStatus = parsed.data.status;

  // On status change, send notifications
  if (nextStatus === "completed" && previousStatus !== "completed") {
    const order = data.order as { id: string; order_no: string; customer: string; created_by: string };

    // Update order ready_quantity from all order pieces of the order.
    const { data: entries } = await supabase
      .from("cutting_entries")
      .select("cut_kg")
      .eq("order_id", order.id)
      .eq("is_order_piece", true);

    const totalCutKg = (entries ?? []).reduce((s: number, e: { cut_kg: number }) => s + Number(e.cut_kg || 0), 0);
    const { error: readyUpdateError } = await supabase
      .from("orders")
      .update({ ready_quantity: totalCutKg, status: "ready" })
      .eq("id", order.id);
    if (readyUpdateError) return NextResponse.json({ error: readyUpdateError.message }, { status: 500 });

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

  if (nextStatus === "in_progress" && previousStatus !== "in_progress" && data.order) {
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

  const supabase = createAdminClient();

  // Get the plan before deleting to keep audit trail
  const { data: plan } = await supabase
    .from("cutting_plans")
    .select("source_stock_id, source_kg, target_kg, order_id")
    .eq("id", params.id)
    .single();

  if (plan) {
    await supabase.from("audit_logs").insert({
      user_id: auth.userId,
      action: "DELETE",
      table_name: "cutting_plans",
      record_id: params.id,
      old_data: plan,
      new_data: null,
    });
  }

  const { error } = await supabase.from("cutting_plans").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
