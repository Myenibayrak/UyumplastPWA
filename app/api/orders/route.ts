import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";
import { orderCreateSchema } from "@/lib/validations";
import { canViewFinance, stripFinanceFields } from "@/lib/rbac";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const orders = canViewFinance(auth.role)
    ? data
    : (data ?? []).map((o) => stripFinanceFields(o));

  return NextResponse.json(orders);
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

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("orders")
    .insert({ ...parsed.data, created_by: auth.userId })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
