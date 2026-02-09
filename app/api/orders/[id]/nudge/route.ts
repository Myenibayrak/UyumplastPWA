import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canSendOrderNudge } from "@/lib/rbac";
import { orderNudgeSchema } from "@/lib/validations";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (!canSendOrderNudge(auth.role, auth.fullName)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = orderNudgeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, order_no, customer")
    .eq("id", params.id)
    .single();
  if (orderError || !order) {
    return NextResponse.json({ error: orderError?.message || "Sipariş bulunamadı" }, { status: 404 });
  }

  const senderName = auth.fullName || "Sistem";
  const payload = {
    user_id: parsed.data.target_user_id,
    title: `Sipariş Dürtme: ${order.order_no}`,
    body: `${senderName}: ${parsed.data.message}`,
    type: "order_nudge",
    ref_id: params.id,
  };

  const { data: notification, error: notificationError } = await supabase
    .from("notifications")
    .insert(payload)
    .select()
    .single();
  if (notificationError || !notification) {
    return NextResponse.json({ error: notificationError?.message || "Bildirim gönderilemedi" }, { status: 500 });
  }

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "notifications",
    record_id: notification.id,
    old_data: null,
    new_data: notification,
  });

  return NextResponse.json({ success: true, notification }, { status: 201 });
}
