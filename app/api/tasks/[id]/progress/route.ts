import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { taskProgressSchema } from "@/lib/validations";
import { isWorkerRole } from "@/lib/rbac";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = taskProgressSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const clearDetailFields = isWorkerRole(auth.role);

  const supabase = createServerSupabase();
  const { error } = await supabase.rpc("update_my_task", {
    p_task_id: params.id,
    p_status: parsed.data.status,
    p_ready_quantity: clearDetailFields ? null : (parsed.data.ready_quantity ?? null),
    p_progress_note: clearDetailFields ? null : (parsed.data.progress_note ?? null),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
