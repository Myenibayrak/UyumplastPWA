import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { taskProgressSchema } from "@/lib/validations";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = taskProgressSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createServerSupabase();
  const { error } = await supabase.rpc("update_my_task", {
    p_task_id: params.id,
    p_status: parsed.data.status,
    p_ready_quantity: parsed.data.ready_quantity ?? null,
    p_progress_note: parsed.data.progress_note ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
