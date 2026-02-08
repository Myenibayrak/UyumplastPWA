import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, isAuthError } from "@/lib/auth/guards";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("get_my_tasks");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
