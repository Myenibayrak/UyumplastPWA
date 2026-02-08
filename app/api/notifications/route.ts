import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, isAuthError } from "@/lib/auth/guards";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  let body: { ids?: string[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const supabase = createServerSupabase();

  if (body.ids && body.ids.length > 0) {
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .in("id", body.ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
