import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";
import { orderCreateSchema } from "@/lib/validations";
import { canViewFinance, stripFinanceFields } from "@/lib/rbac";

export async function GET() {
  try {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;

    const supabase = createAdminClient();
    let { data, error } = await supabase
      .from("orders")
      .select("*, order_tasks(id, department, status, assigned_to, assignee:profiles!order_tasks_assigned_to_fkey(full_name))")
      .order("created_at", { ascending: false });

    // Fallback to auth-bound server client if service-role env is missing/misconfigured.
    if (error || !data || data.length === 0) {
      const serverSupabase = createServerSupabase();
      const retry = await serverSupabase
        .from("orders")
        .select("*, order_tasks(id, department, status, assigned_to, assignee:profiles!order_tasks_assigned_to_fkey(full_name))")
        .order("created_at", { ascending: false });
      data = retry.data;
      error = retry.error;
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const orders = (data ?? []).map((o) => {
      const base = canViewFinance(auth.role) ? o : stripFinanceFields(o);
      const tasks = (o.order_tasks || []) as { department: string; status: string; assignee: { full_name: string } | null }[];
      return {
        ...base,
        order_tasks: undefined,
        task_summary: tasks.map((t) => ({
          department: t.department,
          status: t.status,
          assignee_name: t.assignee?.full_name || null,
        })),
      };
    });

    return NextResponse.json(orders);
  } catch (err) {
    console.error("GET /api/orders error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, ["admin", "sales"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = orderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .insert({ ...parsed.data, created_by: auth.userId })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If source_type is production, notify admin + production users for planning
  if ((parsed.data.source_type === "production" || parsed.data.source_type === "both") && data) {
    const { data: planners } = await supabase
      .from("profiles")
      .select("id")
      .in("role", ["admin", "production"]);

    if (planners && planners.length > 0) {
      const notifications = planners
        .filter((p: { id: string }) => p.id !== auth.userId)
        .map((p: { id: string }) => ({
          user_id: p.id,
          title: "Üretim Planlama Bekliyor",
          body: `${data.order_no} — ${parsed.data.customer} (${parsed.data.product_type}) siparişi üretim gerektiriyor. Planlama yapılmalı.`,
          type: "production_planning",
          ref_id: data.id,
        }));
      if (notifications.length > 0) await supabase.from("notifications").insert(notifications);
    }
  }

  return NextResponse.json(data, { status: 201 });
}
