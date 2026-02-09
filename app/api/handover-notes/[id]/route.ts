import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canManageAllHandover, canViewHandover } from "@/lib/rbac";
import { handoverNoteUpdateSchema } from "@/lib/validations";
import type { AppRole, Priority } from "@/lib/types";

type HandoverRow = {
  id: string;
  department: AppRole;
  shift_date: string;
  title: string;
  details: string;
  priority: Priority;
  status: "open" | "resolved";
  created_by: string;
  resolved_by: string | null;
};

function canAccessHandoverRow(auth: { userId: string; role: AppRole }, row: HandoverRow): boolean {
  if (canManageAllHandover(auth.role)) return true;
  if (row.department === auth.role) return true;
  if (row.created_by === auth.userId) return true;
  if (row.resolved_by === auth.userId) return true;
  return false;
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewHandover(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("handover_notes")
    .select(`
      *,
      creator:profiles!handover_notes_created_by_fkey(id, full_name, role),
      resolver:profiles!handover_notes_resolved_by_fkey(id, full_name, role)
    `)
    .eq("id", params.id)
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Kayıt bulunamadı" }, { status: 404 });
  if (!canAccessHandoverRow(auth, data as unknown as HandoverRow)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
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

  const parsed = handoverNoteUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createAdminClient();
  const { data: before, error: beforeError } = await supabase
    .from("handover_notes")
    .select("*")
    .eq("id", params.id)
    .single();

  if (beforeError || !before) return NextResponse.json({ error: beforeError?.message || "Kayıt bulunamadı" }, { status: 404 });

  const manager = canManageAllHandover(auth.role);
  if (!canAccessHandoverRow(auth, before as HandoverRow)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!manager) {
    if (before.created_by !== auth.userId) {
      return NextResponse.json({ error: "Sadece oluşturduğunuz notu güncelleyebilirsiniz" }, { status: 403 });
    }
    if (parsed.data.department && parsed.data.department !== before.department) {
      return NextResponse.json({ error: "Departman değiştirilemez" }, { status: 403 });
    }
  }

  const updateData: Record<string, unknown> = { ...parsed.data };

  if (parsed.data.title != null) updateData.title = parsed.data.title.trim();
  if (parsed.data.details != null) updateData.details = parsed.data.details.trim();

  if (parsed.data.status === "resolved") {
    updateData.resolved_by = auth.userId;
    updateData.resolved_at = new Date().toISOString();
    updateData.resolved_note = parsed.data.resolved_note?.trim() || null;
  } else if (parsed.data.status === "open") {
    updateData.resolved_by = null;
    updateData.resolved_at = null;
    updateData.resolved_note = null;
  } else if (parsed.data.resolved_note !== undefined) {
    updateData.resolved_note = parsed.data.resolved_note?.trim() || null;
  }

  const { data, error } = await supabase
    .from("handover_notes")
    .update(updateData)
    .eq("id", params.id)
    .select(`
      *,
      creator:profiles!handover_notes_created_by_fkey(id, full_name, role),
      resolver:profiles!handover_notes_resolved_by_fkey(id, full_name, role)
    `)
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Güncelleme başarısız" }, { status: 500 });

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "UPDATE",
    table_name: "handover_notes",
    record_id: params.id,
    old_data: before,
    new_data: data,
  });

  return NextResponse.json(data);
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewHandover(auth.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data: row, error: rowError } = await supabase
    .from("handover_notes")
    .select("*")
    .eq("id", params.id)
    .single();

  if (rowError || !row) return NextResponse.json({ error: rowError?.message || "Kayıt bulunamadı" }, { status: 404 });

  const manager = canManageAllHandover(auth.role);
  const creatorOpenDelete = row.created_by === auth.userId && row.status === "open";
  if (!manager && !creatorOpenDelete) {
    return NextResponse.json({ error: "Bu kaydı silme yetkiniz yok" }, { status: 403 });
  }

  const { error } = await supabase.from("handover_notes").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "DELETE",
    table_name: "handover_notes",
    record_id: params.id,
    old_data: row,
    new_data: null,
  });

  return NextResponse.json({ success: true });
}
