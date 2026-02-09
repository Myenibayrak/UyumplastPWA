import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canManageShippingSchedule, canViewShippingSchedule } from "@/lib/rbac";
import { shippingScheduleCreateSchema } from "@/lib/validations";

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function diffDays(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

async function autoCarryOverSchedules(supabase: ReturnType<typeof createAdminClient>) {
  const today = getTodayIsoDate();
  const { data: overdueRows, error } = await supabase
    .from("shipping_schedules")
    .select("id, scheduled_date, carry_count")
    .eq("status", "planned")
    .lt("scheduled_date", today);

  if (error || !overdueRows || overdueRows.length === 0) return;

  for (const row of overdueRows as Array<{ id: string; scheduled_date: string; carry_count: number | null }>) {
    const missed = diffDays(row.scheduled_date, today);
    await supabase
      .from("shipping_schedules")
      .update({
        scheduled_date: today,
        carry_count: Number(row.carry_count || 0) + Math.max(1, missed),
      })
      .eq("id", row.id);
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (!canViewShippingSchedule(auth.role, auth.fullName)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createAdminClient();
  await autoCarryOverSchedules(supabase);

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const status = searchParams.get("status");

  let query = supabase
    .from("shipping_schedules")
    .select(`
      *,
      order:orders!inner(id, order_no, customer, product_type, quantity, unit, priority, status, ship_date),
      creator:profiles!shipping_schedules_created_by_fkey(id, full_name, role),
      completer:profiles!shipping_schedules_completed_by_fkey(id, full_name, role)
    `)
    .order("scheduled_date", { ascending: true })
    .order("sequence_no", { ascending: true })
    .order("scheduled_time", { ascending: true, nullsFirst: false });

  if (dateFrom) query = query.gte("scheduled_date", dateFrom);
  if (dateTo) query = query.lte("scheduled_date", dateTo);
  if (status && status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (!canManageShippingSchedule(auth.role, auth.fullName)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = shippingScheduleCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createAdminClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, order_no, customer")
    .eq("id", parsed.data.order_id)
    .single();
  if (orderError || !order) {
    return NextResponse.json({ error: orderError?.message || "Sipariş bulunamadı" }, { status: 404 });
  }

  const insertData = {
    order_id: parsed.data.order_id,
    scheduled_date: parsed.data.scheduled_date,
    scheduled_time: parsed.data.scheduled_time ?? null,
    sequence_no: parsed.data.sequence_no,
    status: "planned",
    notes: parsed.data.notes ?? null,
    carry_count: 0,
    created_by: auth.userId,
  };

  const { data, error } = await supabase
    .from("shipping_schedules")
    .insert(insertData)
    .select()
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Plan oluşturulamadı" }, { status: 500 });

  const { data: shippingUsers } = await supabase.from("profiles").select("id").eq("role", "shipping");
  if (shippingUsers && shippingUsers.length > 0) {
    const notifications = shippingUsers
      .filter((u: { id: string }) => u.id !== auth.userId)
      .map((u: { id: string }) => ({
        user_id: u.id,
        title: "Yeni Sevkiyat Planı",
        body: `${order.order_no} - ${order.customer} sevkiyat planına eklendi.`,
        type: "shipping_plan",
        ref_id: data.id,
      }));
    if (notifications.length > 0) await supabase.from("notifications").insert(notifications);
  }

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "shipping_schedules",
    record_id: data.id,
    old_data: null,
    new_data: data,
  });

  return NextResponse.json(data, { status: 201 });
}
