import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canManageAllHandover, canViewHandover } from "@/lib/rbac";
import { handoverNoteCreateSchema } from "@/lib/validations";
import type { AppRole } from "@/lib/types";

type HandoverQueryRow = {
  id: string;
  department: AppRole;
  shift_date: string;
  title: string;
  details: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "resolved";
  created_by: string;
  resolved_by: string | null;
};

function parseLimit(raw: string | null, fallback = 250) {
  const n = Number(raw || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(n)));
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewHandover(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const manager = canManageAllHandover(auth.role);
  const { searchParams } = new URL(request.url);
  const department = searchParams.get("department");
  const status = searchParams.get("status");
  const shiftDate = searchParams.get("shift_date");
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const limit = parseLimit(searchParams.get("limit"));

  if (!manager && department && department !== "all" && department !== auth.role) {
    return NextResponse.json({ error: "Bu departmanı görüntüleme yetkiniz yok" }, { status: 403 });
  }

  const supabase = createAdminClient();
  let query = supabase
    .from("handover_notes")
    .select(`
      *,
      creator:profiles!handover_notes_created_by_fkey(id, full_name, role),
      resolver:profiles!handover_notes_resolved_by_fkey(id, full_name, role)
    `)
    .order("shift_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!manager) {
    query = query.or(`department.eq.${auth.role},created_by.eq.${auth.userId},resolved_by.eq.${auth.userId}`);
  }

  if (department && department !== "all") query = query.eq("department", department);
  if (status && status !== "all") query = query.eq("status", status);
  if (shiftDate) query = query.eq("shift_date", shiftDate);
  if (dateFrom) query = query.gte("shift_date", dateFrom);
  if (dateTo) query = query.lte("shift_date", dateTo);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewHandover(auth.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = handoverNoteCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const manager = canManageAllHandover(auth.role);
  if (!manager && parsed.data.department !== auth.role) {
    return NextResponse.json({ error: "Sadece kendi departmanınıza devir notu girebilirsiniz" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const insertData = {
    department: parsed.data.department,
    shift_date: parsed.data.shift_date,
    title: parsed.data.title.trim(),
    details: parsed.data.details.trim(),
    priority: parsed.data.priority,
    status: "open",
    created_by: auth.userId,
  };

  const { data, error } = await supabase
    .from("handover_notes")
    .insert(insertData)
    .select(`
      *,
      creator:profiles!handover_notes_created_by_fkey(id, full_name, role),
      resolver:profiles!handover_notes_resolved_by_fkey(id, full_name, role)
    `)
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Kayıt oluşturulamadı" }, { status: 500 });

  const { data: recipients } = await supabase
    .from("profiles")
    .select("id, role")
    .or(`role.eq.${parsed.data.department},role.eq.admin,role.eq.sales,role.eq.accounting`);

  const targetIds = Array.from(new Set((recipients ?? []).map((r: { id: string }) => r.id))).filter((id) => id !== auth.userId);
  if (targetIds.length > 0) {
    await supabase.from("notifications").insert(
      targetIds.map((id) => ({
        user_id: id,
        title: "Yeni Devir Notu",
        body: `${parsed.data.department.toUpperCase()} | ${parsed.data.title.trim().slice(0, 120)}`,
        type: "handover_note",
        ref_id: data.id,
      }))
    );
  }

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "handover_notes",
    record_id: data.id,
    old_data: null,
    new_data: data,
  });

  return NextResponse.json(data, { status: 201 });
}
