import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canViewAuditTrail } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewAuditTrail(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const tableName = searchParams.get("table");
  const action = searchParams.get("action");
  const userId = searchParams.get("user_id");
  const limitRaw = Number(searchParams.get("limit") || 200);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : 200;

  const supabase = createAdminClient();
  let query = supabase
    .from("audit_logs")
    .select("*, actor:profiles!audit_logs_user_id_fkey(full_name, role)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (tableName) query = query.eq("table_name", tableName);
  if (action) query = query.eq("action", action);
  if (userId) query = query.eq("user_id", userId);

  let { data, error } = await query;

  // Fallback for environments where FK name differs or relation metadata is stale.
  if (error) {
    let fallbackQuery = supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (tableName) fallbackQuery = fallbackQuery.eq("table_name", tableName);
    if (action) fallbackQuery = fallbackQuery.eq("action", action);
    if (userId) fallbackQuery = fallbackQuery.eq("user_id", userId);

    const retry = await fallbackQuery;
    data = retry.data;
    error = retry.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
