import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canViewDataEntryPanel } from "@/lib/rbac";

const ENTRY_TABLES = [
  "order_stock_entries",
  "production_bobins",
  "cutting_entries",
  "stock_items",
  "stock_movements",
  "shipping_schedules",
  "orders",
  "order_tasks",
  "task_messages",
  "direct_messages",
  "notifications",
] as const;

type AuditRow = {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  actor?: { full_name?: string | null; role?: string | null } | null;
};

function parseSince(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewDataEntryPanel(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") || "entries";
  const table = searchParams.get("table");
  const action = searchParams.get("action");
  const userId = searchParams.get("user_id");
  const since = parseSince(searchParams.get("since"));
  const limitRaw = Number(searchParams.get("limit") || 300);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(800, Math.trunc(limitRaw))) : 300;

  const supabase = createAdminClient();
  let query = supabase
    .from("audit_logs")
    .select("*, actor:profiles!audit_logs_user_id_fkey(full_name, role)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (mode === "entries" && (!table || table === "all")) {
    query = query.in("table_name", [...ENTRY_TABLES]);
  }
  if (table && table !== "all") query = query.eq("table_name", table);
  if (action && action !== "all") query = query.eq("action", action);
  if (userId) query = query.eq("user_id", userId);
  if (since) query = query.gte("created_at", since);

  let { data, error } = await query;

  // Fallback for stale relation metadata in some environments.
  if (error) {
    let fallbackQuery = supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (mode === "entries" && (!table || table === "all")) {
      fallbackQuery = fallbackQuery.in("table_name", [...ENTRY_TABLES]);
    }
    if (table && table !== "all") fallbackQuery = fallbackQuery.eq("table_name", table);
    if (action && action !== "all") fallbackQuery = fallbackQuery.eq("action", action);
    if (userId) fallbackQuery = fallbackQuery.eq("user_id", userId);
    if (since) fallbackQuery = fallbackQuery.gte("created_at", since);

    const retry = await fallbackQuery;
    data = retry.data;
    error = retry.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = ((data ?? []) as AuditRow[]).map((row) => ({
    ...row,
    row_data: row.new_data ?? row.old_data,
  }));

  return NextResponse.json({
    rows,
    tables: [...ENTRY_TABLES],
    total: rows.length,
  });
}
