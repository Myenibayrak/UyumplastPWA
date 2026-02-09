import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canManageShippingSchedule, canViewShippingSchedule } from "@/lib/rbac";
import { shippingScheduleCreateSchema } from "@/lib/validations";
import { isMissingTableError } from "@/lib/supabase/postgrest-errors";
import { insertVirtualRow, listVirtualRows, updateVirtualRow } from "@/lib/virtual-store";

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getTomorrowIsoDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function diffDays(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

type VirtualShippingRow = {
  id: string;
  order_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  sequence_no: number;
  status: "planned" | "completed" | "cancelled";
  notes: string | null;
  carry_count: number;
  created_by: string;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const VIRTUAL_TABLE = "virtual_shipping_schedules";

async function autoCarryOverSchedules(supabase: ReturnType<typeof createAdminClient>) {
  const today = getTodayIsoDate();
  const tomorrow = getTomorrowIsoDate();
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
        scheduled_date: tomorrow,
        carry_count: Number(row.carry_count || 0) + Math.max(1, missed),
      })
      .eq("id", row.id);
  }
}

async function autoCarryOverVirtualSchedules(supabase: ReturnType<typeof createAdminClient>, userId: string) {
  const today = getTodayIsoDate();
  const tomorrow = getTomorrowIsoDate();
  const rows = await listVirtualRows<VirtualShippingRow>(supabase, VIRTUAL_TABLE, { limit: 12000 });
  const overdue = rows.filter((r) => r.status === "planned" && r.scheduled_date < today);
  for (const row of overdue) {
    const missed = diffDays(row.scheduled_date, today);
    await updateVirtualRow<VirtualShippingRow>(supabase, VIRTUAL_TABLE, userId, row.id, {
      scheduled_date: tomorrow,
      carry_count: Number(row.carry_count || 0) + Math.max(1, missed),
    });
  }
}

async function enrichVirtualSchedules(
  supabase: ReturnType<typeof createAdminClient>,
  rows: VirtualShippingRow[]
) {
  if (rows.length === 0) return [];
  const orderIds = Array.from(new Set(rows.map((r) => r.order_id)));
  const profileIds = Array.from(
    new Set(rows.flatMap((r) => [r.created_by, r.completed_by]).filter((v): v is string => Boolean(v)))
  );

  const [ordersRes, profilesRes] = await Promise.all([
    orderIds.length > 0
      ? supabase
          .from("orders")
          .select("id, order_no, customer, product_type, quantity, unit, priority, status, ship_date")
          .in("id", orderIds)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, full_name, role")
          .in("id", profileIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const orderMap = new Map((ordersRes.data ?? []).map((o: { id: string }) => [o.id, o]));
  const profileMap = new Map((profilesRes.data ?? []).map((p: { id: string }) => [p.id, p]));

  return rows.map((row) => ({
    ...row,
    order: orderMap.get(row.order_id) ?? null,
    creator: profileMap.get(row.created_by) ?? null,
    completer: row.completed_by ? profileMap.get(row.completed_by) ?? null : null,
  }));
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
  if (error) {
    if (isMissingTableError(error, "shipping_schedules")) {
      await autoCarryOverVirtualSchedules(supabase, auth.userId);
      let rows = await listVirtualRows<VirtualShippingRow>(supabase, VIRTUAL_TABLE, { limit: 12000 });
      if (dateFrom) rows = rows.filter((r) => r.scheduled_date >= dateFrom);
      if (dateTo) rows = rows.filter((r) => r.scheduled_date <= dateTo);
      if (status && status !== "all") rows = rows.filter((r) => r.status === status);
      rows = rows
        .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
        .sort((a, b) => a.sequence_no - b.sequence_no);
      const enriched = await enrichVirtualSchedules(supabase, rows);
      return NextResponse.json(enriched);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
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

  if (error && isMissingTableError(error, "shipping_schedules")) {
    const virtual = await insertVirtualRow<VirtualShippingRow>(supabase, VIRTUAL_TABLE, auth.userId, {
      order_id: parsed.data.order_id,
      scheduled_date: parsed.data.scheduled_date,
      scheduled_time: parsed.data.scheduled_time ?? null,
      sequence_no: parsed.data.sequence_no,
      status: "planned",
      notes: parsed.data.notes ?? null,
      carry_count: 0,
      created_by: auth.userId,
      completed_by: null,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as VirtualShippingRow);

    const { data: shippingUsers } = await supabase.from("profiles").select("id").eq("role", "shipping");
    if (shippingUsers && shippingUsers.length > 0) {
      const notifications = shippingUsers
        .filter((u: { id: string }) => u.id !== auth.userId)
        .map((u: { id: string }) => ({
          user_id: u.id,
          title: "Yeni Sevkiyat Planı",
          body: `${order.order_no} - ${order.customer} sevkiyat planına eklendi.`,
          type: "shipping_plan",
          ref_id: virtual.id,
        }));
      if (notifications.length > 0) await supabase.from("notifications").insert(notifications);
    }

    return NextResponse.json(virtual, { status: 201 });
  }
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
