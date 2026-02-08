import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

export interface AuthResult {
  userId: string;
  role: AppRole;
  fullName?: string | null;
}

export async function requireAuth(): Promise<AuthResult | NextResponse> {
  const supabase = createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 403 });
  }
  return { userId: user.id, role: profile.role as AppRole, fullName: profile.full_name ?? null };
}

export function requireRole(auth: AuthResult, roles: AppRole[]): NextResponse | null {
  if (!roles.includes(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export function isAuthError(result: AuthResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
