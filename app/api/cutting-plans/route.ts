import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";
import { cuttingPlanCreateSchema } from "@/lib/validations";
import type { OrderStatus } from "@/lib/types";
import { isMissingRelationshipError, isMissingTableError } from "@/lib/supabase/postgrest-errors";

type CuttingPlanBase = {
  id: string;
  order_id: string;
  assigned_to: string | null;
  planned_by: string | null;
} & Record<string, unknown>;

async function enrichCuttingPlans(supabase: ReturnType<typeof createAdminClient>, rows: CuttingPlanBase[]) {
  if (rows.length === 0) return [];

  const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter(Boolean)));
  const profileIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.assigned_to, r.planned_by])
        .filter((v): v is string => Boolean(v))
    )
  );
  const planIds = rows.map((r) => r.id);

  const [ordersRes, profilesRes, entriesRes] = await Promise.all([
    orderIds.length > 0
      ? supabase
          .from("orders")
          .select("id, order_no, customer, product_type, micron, width, quantity, unit, trim_width, ship_date, priority, status")
          .in("id", orderIds)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, full_name, role")
          .in("id", profileIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length > 0
      ? supabase
          .from("cutting_entries")
          .select("*")
          .in("cutting_plan_id", planIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const orderMap = new Map((ordersRes.data ?? []).map((o: { id: string }) => [o.id, o]));
  const profileMap = new Map((profilesRes.data ?? []).map((p: { id: string }) => [p.id, p]));
  const entriesMap = new Map<string, Array<Record<string, unknown>>>();
  for (const entry of (entriesRes.data ?? []) as Array<Record<string, unknown>>) {
    const planId = String(entry.cutting_plan_id || "");
    if (!planId) continue;
    const list = entriesMap.get(planId) ?? [];
    list.push(entry);
    entriesMap.set(planId, list);
  }

  return rows.map((row) => ({
    ...row,
    order: orderMap.get(row.order_id) ?? null,
    assignee: row.assigned_to ? profileMap.get(row.assigned_to) ?? null : null,
    planner: row.planned_by ? profileMap.get(row.planned_by) ?? null : null,
    entries: entriesMap.get(row.id) ?? [],
  }));
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const assignedTo = searchParams.get("assigned_to");

  const supabase = createAdminClient();
  let query = supabase
    .from("cutting_plans")
    .select(`
      *,
      order:orders!inner(id, order_no, customer, product_type, micron, width, quantity, unit, trim_width, ship_date, priority, status),
      assignee:profiles!cutting_plans_assigned_to_fkey(id, full_name, role),
      planner:profiles!cutting_plans_planned_by_fkey(id, full_name, role),
      entries:cutting_entries(*)
    `)
    .order("created_at", { ascending: false });

  if (status && status !== "all") query = query.eq("status", status);
  if (assignedTo) query = query.eq("assigned_to", assignedTo);

  let { data, error } = await query;
  if (error) {
    if (isMissingTableError(error, "cutting_plans")) return NextResponse.json([]);
    if (
      isMissingRelationshipError(error, "cutting_plans", "profiles")
      || isMissingRelationshipError(error, "cutting_plans", "orders")
      || isMissingRelationshipError(error, "cutting_plans", "cutting_entries")
    ) {
      let fallbackQuery = supabase
        .from("cutting_plans")
        .select("*")
        .order("created_at", { ascending: false });
      if (status && status !== "all") fallbackQuery = fallbackQuery.eq("status", status);
      if (assignedTo) fallbackQuery = fallbackQuery.eq("assigned_to", assignedTo);

      const retry = await fallbackQuery;
      if (retry.error) {
        if (isMissingTableError(retry.error, "cutting_plans")) return NextResponse.json([]);
        return NextResponse.json({ error: retry.error.message }, { status: 500 });
      }

      const enriched = await enrichCuttingPlans(supabase, (retry.data ?? []) as CuttingPlanBase[]);
      return NextResponse.json(enriched);
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, ["admin", "sales", "production"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = cuttingPlanCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", parsed.data.order_id)
    .single();
  if (orderError || !order) {
    return NextResponse.json({ error: orderError?.message || "Sipariş bulunamadı" }, { status: 404 });
  }

  const blockedStatuses: OrderStatus[] = ["cancelled", "closed", "shipped", "delivered"];
  if (blockedStatuses.includes(order.status as OrderStatus)) {
    return NextResponse.json({ error: "Bu sipariş için plan oluşturulamaz" }, { status: 400 });
  }

  let sourceProduct = parsed.data.source_product;
  let sourceMicron = parsed.data.source_micron ?? null;
  let sourceWidth = parsed.data.source_width ?? null;
  let sourceKg = parsed.data.source_kg ?? null;

  if (parsed.data.source_stock_id) {
    const { data: stockItem, error: stockError } = await supabase
      .from("stock_items")
      .select("id, category, product, micron, width, kg")
      .eq("id", parsed.data.source_stock_id)
      .single();
    if (stockError && isMissingTableError(stockError, "stock_items")) {
      return NextResponse.json(
        { error: "Stok altyapısı hazır değil. Veritabanı kurulumunu tamamlayın." },
        { status: 503 }
      );
    }
    if (stockError || !stockItem) {
      return NextResponse.json({ error: stockError?.message || "Kaynak stok kartı bulunamadı" }, { status: 404 });
    }
    if (stockItem.category !== "film") {
      return NextResponse.json({ error: "Kesim planında kaynak stok kategorisi film olmalı" }, { status: 400 });
    }
    if (Number(stockItem.kg || 0) <= 0) {
      return NextResponse.json({ error: "Kaynak stokta kullanılabilir kg yok" }, { status: 400 });
    }

    sourceProduct = stockItem.product;
    sourceMicron = stockItem.micron;
    sourceWidth = stockItem.width;
    sourceKg = stockItem.kg;
  }

  const planData = {
    order_id: parsed.data.order_id,
    source_stock_id: parsed.data.source_stock_id ?? null,
    source_product: sourceProduct,
    source_micron: sourceMicron,
    source_width: sourceWidth,
    source_kg: sourceKg,
    target_width: parsed.data.target_width ?? null,
    target_kg: parsed.data.target_kg ?? null,
    target_quantity: parsed.data.target_quantity ?? 1,
    assigned_to: parsed.data.assigned_to ?? null,
    planned_by: auth.userId,
    notes: parsed.data.notes ?? null,
  };

  const { data, error } = await supabase
    .from("cutting_plans")
    .insert(planData)
    .select()
    .single();

  if (error && isMissingTableError(error, "cutting_plans")) {
    return NextResponse.json(
      { error: "Üretim planı altyapısı hazır değil. Veritabanı kurulumunu tamamlayın." },
      { status: 503 }
    );
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Move order into production only when it is in pre-production states.
  if (order.status === "draft" || order.status === "confirmed") {
    const { error: orderUpdateError } = await supabase
      .from("orders")
      .update({
        status: "in_production",
      })
      .eq("id", parsed.data.order_id)
      .in("status", ["draft", "confirmed"]);
    if (orderUpdateError) {
      await supabase.from("cutting_plans").delete().eq("id", data.id);
      return NextResponse.json({ error: orderUpdateError.message }, { status: 500 });
    }
  }

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "cutting_plans",
    record_id: data.id,
    old_data: null,
    new_data: data,
  });

  // Notify assigned operator
  if (planData.assigned_to) {
    const orderRes = await supabase.from("orders").select("order_no, customer").eq("id", parsed.data.order_id).single();
    const order = orderRes.data;
    if (order) {
      await supabase.from("notifications").insert({
        user_id: planData.assigned_to,
        title: "Yeni Kesim Planı",
        body: `${order.order_no} - ${order.customer} siparişi için kesim planı atandı.`,
        type: "task_assigned",
        ref_id: data.id,
      });
    }
  }

  return NextResponse.json(data, { status: 201 });
}
