import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { isWorkerRole } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { searchParams } = new URL(request.url);
  const deptFilter = searchParams.get("department");

  const supabase = createServerSupabase();

  if (isWorkerRole(auth.role)) {
    const { data, error } = await supabase.rpc("get_my_tasks");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  }

  let query = supabase
    .from("order_tasks")
    .select(`
      *,
      order:orders!inner(order_no, customer, product_type, micron, width, quantity, unit, trim_width, ship_date, priority, notes, status),
      assignee:profiles!order_tasks_assigned_to_fkey(id, full_name, role),
      assigner:profiles!order_tasks_assigned_by_fkey(id, full_name, role)
    `)
    .order("created_at", { ascending: false });

  if (deptFilter && deptFilter !== "all") {
    query = query.eq("department", deptFilter);
  }

  let { data, error } = await query;
  if (error && /assigned_by|order_tasks_assigned_by_fkey/i.test(error.message || "")) {
    let fallbackQuery = supabase
      .from("order_tasks")
      .select(`
        *,
        order:orders!inner(order_no, customer, product_type, micron, width, quantity, unit, trim_width, ship_date, priority, notes, status),
        assignee:profiles!order_tasks_assigned_to_fkey(id, full_name, role)
      `)
      .order("created_at", { ascending: false });
    if (deptFilter && deptFilter !== "all") {
      fallbackQuery = fallbackQuery.eq("department", deptFilter);
    }
    const retry = await fallbackQuery;
    data = retry.data;
    error = retry.error;
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tasks = (data ?? []).map((t) => {
    const o = t.order as Record<string, unknown> | null;
    return {
      ...t,
      order_no: o?.order_no ?? "",
      customer: o?.customer ?? "",
      product_type: o?.product_type ?? "",
      micron: o?.micron ?? null,
      width: o?.width ?? null,
      quantity: o?.quantity ?? null,
      unit: o?.unit ?? "kg",
      trim_width: o?.trim_width ?? null,
      ship_date: o?.ship_date ?? null,
      order_priority: o?.priority ?? "normal",
      order_notes: o?.notes ?? null,
      order_status: o?.status ?? "draft",
      assignee_name: (t.assignee as Record<string, unknown> | null)?.full_name ?? null,
      assigned_by_name: (t.assigner as Record<string, unknown> | null)?.full_name ?? null,
    };
  });

  return NextResponse.json(tasks);
}
