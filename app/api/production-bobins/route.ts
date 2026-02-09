import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";
import { PRODUCTION_READY_STATUSES } from "@/lib/production-ready";
import { calculateReadyMetrics, deriveOrderStatusFromReady } from "@/lib/order-ready";
import { isMissingRelationshipError, isMissingTableError } from "@/lib/supabase/postgrest-errors";

type BobinBase = {
  id: string;
  order_id: string;
  cutting_plan_id: string | null;
  entered_by: string | null;
  warehouse_in_by: string | null;
} & Record<string, unknown>;

type CuttingEntryRow = {
  id: string;
  order_id: string;
  cutting_plan_id: string;
  bobbin_label: string;
  cut_kg: number;
  notes: string | null;
  entered_by: string | null;
  created_at: string;
};

async function enrichBobins(supabase: ReturnType<typeof createAdminClient>, rows: BobinBase[]) {
  if (rows.length === 0) return [];

  const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter(Boolean)));
  const cuttingPlanIds = Array.from(new Set(rows.map((r) => r.cutting_plan_id).filter((v): v is string => Boolean(v))));
  const profileIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.entered_by, r.warehouse_in_by])
        .filter((v): v is string => Boolean(v))
    )
  );

  const [ordersRes, plansRes, profilesRes] = await Promise.all([
    orderIds.length > 0
      ? supabase
          .from("orders")
          .select("id, order_no, customer, product_type, micron, width, quantity, unit")
          .in("id", orderIds)
      : Promise.resolve({ data: [], error: null }),
    cuttingPlanIds.length > 0
      ? supabase
          .from("cutting_plans")
          .select("id, source_product, target_width")
          .in("id", cuttingPlanIds)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", profileIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const orderMap = new Map((ordersRes.data ?? []).map((o: { id: string }) => [o.id, o]));
  const planMap = new Map((plansRes.data ?? []).map((p: { id: string }) => [p.id, p]));
  const profileMap = new Map((profilesRes.data ?? []).map((p: { id: string }) => [p.id, p]));

  return rows.map((row) => ({
    ...row,
    order: orderMap.get(row.order_id) ?? null,
    cutting_plan: row.cutting_plan_id ? planMap.get(row.cutting_plan_id) ?? null : null,
    entered_by_profile: row.entered_by ? profileMap.get(row.entered_by) ?? null : null,
    warehouse_in_by_profile: row.warehouse_in_by ? profileMap.get(row.warehouse_in_by) ?? null : null,
  }));
}

async function recalculateProductionReadyKg(supabase: ReturnType<typeof createAdminClient>, orderId: string) {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, quantity, status, source_type, stock_ready_kg")
    .eq("id", orderId)
    .single();
  if (orderError || !order) return;

  const { data: rows } = await supabase
    .from("production_bobins")
    .select("kg")
    .eq("order_id", orderId)
    .in("status", [...PRODUCTION_READY_STATUSES]);

  const totalKg = (rows ?? []).reduce((sum: number, r: { kg: number }) => sum + Number(r.kg || 0), 0);
  const metrics = calculateReadyMetrics(order.quantity, order.stock_ready_kg, totalKg);
  const nextStatus = deriveOrderStatusFromReady(order.status, order.source_type, metrics.isReady);

  const updateData: Record<string, unknown> = { production_ready_kg: totalKg };
  if (nextStatus && nextStatus !== order.status) {
    updateData.status = nextStatus;
  }

  await supabase.from("orders").update(updateData).eq("id", orderId);
}

async function recalculateProductionReadyKgFromCuttingEntries(supabase: ReturnType<typeof createAdminClient>, orderId: string) {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, quantity, status, source_type, stock_ready_kg")
    .eq("id", orderId)
    .single();
  if (orderError || !order) return;

  const { data: rows } = await supabase
    .from("cutting_entries")
    .select("cut_kg")
    .eq("order_id", orderId)
    .eq("is_order_piece", true);

  const totalKg = (rows ?? []).reduce((sum: number, r: { cut_kg: number }) => sum + Number(r.cut_kg || 0), 0);
  const metrics = calculateReadyMetrics(order.quantity, order.stock_ready_kg, totalKg);
  const nextStatus = deriveOrderStatusFromReady(order.status, order.source_type, metrics.isReady);

  const updateData: Record<string, unknown> = { production_ready_kg: totalKg };
  if (nextStatus && nextStatus !== order.status) {
    updateData.status = nextStatus;
  }

  await supabase.from("orders").update(updateData).eq("id", orderId);
}

async function listBobinsFromCuttingEntries(
  supabase: ReturnType<typeof createAdminClient>,
  opts: { orderId?: string | null; cuttingPlanId?: string | null; status?: string | null }
) {
  let query = supabase
    .from("cutting_entries")
    .select("id, order_id, cutting_plan_id, bobbin_label, cut_kg, notes, entered_by, created_at")
    .eq("is_order_piece", true)
    .order("created_at", { ascending: false });

  if (opts.orderId) query = query.eq("order_id", opts.orderId);
  if (opts.cuttingPlanId) query = query.eq("cutting_plan_id", opts.cuttingPlanId);

  const { data: entries, error } = await query;
  if (error) return { error: error.message, rows: [] as Record<string, unknown>[] };

  const normalizedStatus = opts.status && opts.status !== "all" ? opts.status : null;
  if (normalizedStatus && !["produced", "warehouse", "ready"].includes(normalizedStatus)) {
    return { error: null, rows: [] as Record<string, unknown>[] };
  }

  const entryRows = (entries ?? []) as CuttingEntryRow[];
  if (entryRows.length === 0) return { error: null, rows: [] as Record<string, unknown>[] };

  const orderIds = Array.from(new Set(entryRows.map((r) => r.order_id)));
  const planIds = Array.from(new Set(entryRows.map((r) => r.cutting_plan_id)));
  const profileIds = Array.from(new Set(entryRows.map((r) => r.entered_by).filter((v): v is string => Boolean(v))));

  const [ordersRes, plansRes, profilesRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_no, customer, product_type, micron, width, quantity, unit")
      .in("id", orderIds),
    supabase
      .from("cutting_plans")
      .select("id, source_product, target_width")
      .in("id", planIds),
    profileIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", profileIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }>, error: null }),
  ]);

  const orderMap = new Map((ordersRes.data ?? []).map((o: { id: string }) => [o.id, o]));
  const planMap = new Map((plansRes.data ?? []).map((p: { id: string }) => [p.id, p]));
  const profileMap = new Map((profilesRes.data ?? []).map((p: { id: string }) => [p.id, p]));

  let rows = entryRows.map((entry) => {
    const order = orderMap.get(entry.order_id) as Record<string, unknown> | undefined;
    return {
      id: entry.id,
      order_id: entry.order_id,
      cutting_plan_id: entry.cutting_plan_id,
      bobbin_no: entry.bobbin_label,
      meter: 0,
      kg: Number(entry.cut_kg || 0),
      fire_kg: 0,
      product_type: String(order?.product_type || ""),
      micron: (order?.micron ?? null) as number | null,
      width: (order?.width ?? null) as number | null,
      status: "produced",
      notes: entry.notes,
      entered_by: entry.entered_by,
      entered_at: entry.created_at,
      warehouse_in_at: null,
      warehouse_in_by: null,
      created_at: entry.created_at,
      updated_at: entry.created_at,
      order: order ?? null,
      cutting_plan: planMap.get(entry.cutting_plan_id) ?? null,
      entered_by_profile: entry.entered_by ? profileMap.get(entry.entered_by) ?? null : null,
      warehouse_in_by_profile: null,
    };
  });

  if (normalizedStatus && normalizedStatus !== "produced") {
    rows = [];
  }

  return { error: null, rows };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("order_id");
  const status = searchParams.get("status");
  const cuttingPlanId = searchParams.get("cutting_plan_id");

  const supabase = createAdminClient();
  let query = supabase
    .from("production_bobins")
    .select(`
      *,
      order:orders!inner(id, order_no, customer, product_type, micron, width, quantity, unit),
      cutting_plan:cutting_plans(id, source_product, target_width),
      entered_by_profile:profiles!production_bobins_entered_by_fkey(full_name),
      warehouse_in_by_profile:profiles!production_bobins_warehouse_in_by_fkey(full_name)
    `)
    .order("entered_at", { ascending: false });

  if (orderId) query = query.eq("order_id", orderId);
  if (cuttingPlanId) query = query.eq("cutting_plan_id", cuttingPlanId);
  if (status && status !== "all") query = query.eq("status", status);

  let { data, error } = await query;
  if (error) {
    if (isMissingTableError(error, "production_bobins")) {
      const fallback = await listBobinsFromCuttingEntries(supabase, { orderId, cuttingPlanId, status });
      if (fallback.error) return NextResponse.json({ error: fallback.error }, { status: 500 });
      return NextResponse.json(fallback.rows);
    }
    if (
      isMissingRelationshipError(error, "production_bobins", "profiles")
      || isMissingRelationshipError(error, "production_bobins", "orders")
      || isMissingRelationshipError(error, "production_bobins", "cutting_plans")
    ) {
      let fallback = supabase
        .from("production_bobins")
        .select("*")
        .order("entered_at", { ascending: false });
      if (orderId) fallback = fallback.eq("order_id", orderId);
      if (cuttingPlanId) fallback = fallback.eq("cutting_plan_id", cuttingPlanId);
      if (status && status !== "all") fallback = fallback.eq("status", status);

      const retry = await fallback;
      if (retry.error) {
        if (isMissingTableError(retry.error, "production_bobins")) return NextResponse.json([]);
        return NextResponse.json({ error: retry.error.message }, { status: 500 });
      }

      const enriched = await enrichBobins(supabase, (retry.data ?? []) as BobinBase[]);
      return NextResponse.json(enriched);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, ["admin", "production"]);
  if (roleCheck) return roleCheck;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validation
  if (!body.order_id || !body.bobbin_no || !body.meter || !body.kg) {
    return NextResponse.json(
      { error: "order_id, bobbin_no, meter, kg zorunlu" },
      { status: 400 }
    );
  }
  const meter = Number(body.meter);
  const kg = Number(body.kg);
  if (!Number.isFinite(meter) || meter <= 0 || !Number.isFinite(kg) || kg <= 0) {
    return NextResponse.json({ error: "meter ve kg pozitif sayı olmalı" }, { status: 400 });
  }

  const supabase = createAdminClient();
  // Get order info for automatic fields and enforce source/status constraints.
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, product_type, micron, width, status, source_type")
    .eq("id", body.order_id)
    .single();
  if (orderError || !order) {
    return NextResponse.json({ error: orderError?.message || "Sipariş bulunamadı" }, { status: 404 });
  }
  if (order.source_type === "stock") {
    return NextResponse.json({ error: "Bu sipariş için üretim bobini girişi yapılamaz" }, { status: 400 });
  }
  if (["shipped", "delivered", "cancelled", "closed"].includes(String(order.status))) {
    return NextResponse.json({ error: "Bu sipariş için üretim bobini girişi yapılamaz" }, { status: 400 });
  }

  const bobinData = {
    order_id: body.order_id,
    cutting_plan_id: body.cutting_plan_id || null,
    bobbin_no: body.bobbin_no,
    meter,
    kg,
    fire_kg: body.fire_kg ? Number(body.fire_kg) : 0,
    product_type: order?.product_type || "",
    micron: order?.micron,
    width: order?.width,
    status: "produced",
    notes: body.notes || null,
    entered_by: auth.userId,
  };

  const { data, error } = await supabase
    .from("production_bobins")
    .insert(bobinData)
    .select()
    .single();

  if (error && isMissingTableError(error, "production_bobins")) {
    const cuttingPlanId = String(body.cutting_plan_id || "");
    if (!cuttingPlanId) {
      return NextResponse.json({ error: "Kesim planı seçilmeden bobin kaydı açılamaz" }, { status: 400 });
    }

    const { data: plan, error: planError } = await supabase
      .from("cutting_plans")
      .select("id, order_id, source_stock_id, target_width")
      .eq("id", cuttingPlanId)
      .single();
    if (planError || !plan) {
      return NextResponse.json({ error: planError?.message || "Kesim planı bulunamadı" }, { status: 404 });
    }
    if (plan.order_id !== body.order_id) {
      return NextResponse.json({ error: "Kesim planı ve sipariş eşleşmiyor" }, { status: 400 });
    }

    const cutWidth = Number(plan.target_width || order.width || 0);
    if (!Number.isFinite(cutWidth) || cutWidth <= 0) {
      return NextResponse.json({ error: "Kesim planında hedef en eksik. Önce planı güncelleyin." }, { status: 400 });
    }

    const { data: entry, error: entryError } = await supabase
      .from("cutting_entries")
      .insert({
        cutting_plan_id: plan.id,
        order_id: plan.order_id,
        source_stock_id: plan.source_stock_id,
        bobbin_label: body.bobbin_no,
        cut_width: cutWidth,
        cut_kg: kg,
        cut_quantity: 1,
        is_order_piece: true,
        entered_by: auth.userId,
        notes: body.notes || null,
      })
      .select("*")
      .single();
    if (entryError || !entry) {
      return NextResponse.json({ error: entryError?.message || "Bobin kaydı oluşturulamadı" }, { status: 500 });
    }

    await recalculateProductionReadyKgFromCuttingEntries(supabase, String(body.order_id));

    const fallback = await listBobinsFromCuttingEntries(supabase, { orderId: String(body.order_id), cuttingPlanId, status: "all" });
    const row = fallback.rows.find((r) => String(r.id) === String(entry.id));
    return NextResponse.json(row ?? {
      id: entry.id,
      order_id: entry.order_id,
      cutting_plan_id: entry.cutting_plan_id,
      bobbin_no: entry.bobbin_label,
      meter: 0,
      kg: entry.cut_kg,
      fire_kg: 0,
      product_type: order.product_type,
      micron: order.micron,
      width: order.width,
      status: "produced",
      notes: entry.notes,
      entered_by: entry.entered_by,
      entered_at: entry.created_at,
      warehouse_in_at: null,
      warehouse_in_by: null,
      created_at: entry.created_at,
      updated_at: entry.created_at,
    }, { status: 201 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Trigger olmayan ortamlarda da tutarlılık için toplamı API'de garanti et.
  await recalculateProductionReadyKg(supabase, body.order_id as string);

  // Şeffaflık için işlem geçmişi (audit) tut.
  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "production_bobins",
    record_id: data.id,
    old_data: null,
    new_data: data,
  });

  return NextResponse.json(data, { status: 201 });
}
