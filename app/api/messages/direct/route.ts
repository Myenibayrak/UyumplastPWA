import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { directMessageCreateSchema } from "@/lib/validations";
import { isMissingTableError } from "@/lib/supabase/postgrest-errors";
import { insertVirtualRow, listVirtualRows, updateVirtualRow } from "@/lib/virtual-store";

type DirectMessageRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  parent_id: string | null;
  message: string;
  read_at: string | null;
  created_at: string;
  updated_at?: string;
};

const VIRTUAL_TABLE = "virtual_direct_messages";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { searchParams } = new URL(request.url);
  const counterpartId = searchParams.get("counterpart_id");

  const supabase = createAdminClient();

  if (counterpartId) {
    const { data, error } = await supabase
      .from("direct_messages")
      .select(`
        *,
        sender:profiles!direct_messages_sender_id_fkey(id, full_name, role),
        recipient:profiles!direct_messages_recipient_id_fkey(id, full_name, role)
      `)
      .or(`and(sender_id.eq.${auth.userId},recipient_id.eq.${counterpartId}),and(sender_id.eq.${counterpartId},recipient_id.eq.${auth.userId})`)
      .order("created_at", { ascending: true })
      .limit(400);

    if (error) {
      if (isMissingTableError(error, "direct_messages")) {
        const all = await listVirtualRows<DirectMessageRow>(supabase, VIRTUAL_TABLE, { limit: 10000 });
        const filtered = all
          .filter((m) =>
            (m.sender_id === auth.userId && m.recipient_id === counterpartId)
            || (m.sender_id === counterpartId && m.recipient_id === auth.userId)
          )
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

        const unread = filtered.filter((m) => m.recipient_id === auth.userId && !m.read_at);
        await Promise.all(
          unread.map((row) =>
            updateVirtualRow<DirectMessageRow>(supabase, VIRTUAL_TABLE, auth.userId, row.id, { read_at: new Date().toISOString() })
          )
        );

        return NextResponse.json(filtered);
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase
      .from("direct_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", auth.userId)
      .eq("sender_id", counterpartId)
      .is("read_at", null);

    return NextResponse.json(data ?? []);
  }

  const { data, error } = await supabase
    .from("direct_messages")
    .select("id, sender_id, recipient_id, message, read_at, created_at")
    .or(`sender_id.eq.${auth.userId},recipient_id.eq.${auth.userId}`)
    .order("created_at", { ascending: false })
    .limit(800);

  if (error) {
    if (isMissingTableError(error, "direct_messages")) {
      const rows = await listVirtualRows<DirectMessageRow>(supabase, VIRTUAL_TABLE, { limit: 12000 });
      const mine = rows
        .filter((row) => row.sender_id === auth.userId || row.recipient_id === auth.userId)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

      const byCounterpart = new Map<string, {
        counterpart_id: string;
        last_message: string;
        last_at: string;
        unread_count: number;
      }>();

      for (const row of mine) {
        const counterpartIdResolved = row.sender_id === auth.userId ? row.recipient_id : row.sender_id;
        const existing = byCounterpart.get(counterpartIdResolved);

        if (!existing) {
          byCounterpart.set(counterpartIdResolved, {
            counterpart_id: counterpartIdResolved,
            last_message: row.message,
            last_at: row.created_at,
            unread_count: row.recipient_id === auth.userId && row.read_at == null ? 1 : 0,
          });
        } else if (row.recipient_id === auth.userId && row.read_at == null) {
          existing.unread_count += 1;
        }
      }

      const counterparts = Array.from(byCounterpart.keys());
      if (counterparts.length === 0) return NextResponse.json([]);

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .in("id", counterparts);
      const profileMap = new Map((profiles ?? []).map((p: { id: string; full_name: string; role: string }) => [p.id, p]));

      const result = Array.from(byCounterpart.values())
        .map((item) => ({
          ...item,
          counterpart: profileMap.get(item.counterpart_id) ?? null,
        }))
        .sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));

      return NextResponse.json(result);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as DirectMessageRow[];
  const byCounterpart = new Map<string, {
    counterpart_id: string;
    last_message: string;
    last_at: string;
    unread_count: number;
  }>();

  for (const row of rows) {
    const counterpartIdResolved = row.sender_id === auth.userId ? row.recipient_id : row.sender_id;
    const existing = byCounterpart.get(counterpartIdResolved);

    if (!existing) {
      byCounterpart.set(counterpartIdResolved, {
        counterpart_id: counterpartIdResolved,
        last_message: row.message,
        last_at: row.created_at,
        unread_count: row.recipient_id === auth.userId && row.read_at == null ? 1 : 0,
      });
    } else if (row.recipient_id === auth.userId && row.read_at == null) {
      existing.unread_count += 1;
    }
  }

  const counterparts = Array.from(byCounterpart.keys());
  if (counterparts.length === 0) return NextResponse.json([]);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("id", counterparts);

  const profileMap = new Map((profiles ?? []).map((p: { id: string; full_name: string; role: string }) => [p.id, p]));

  const result = Array.from(byCounterpart.values())
    .map((item) => ({
      ...item,
      counterpart: profileMap.get(item.counterpart_id) ?? null,
    }))
    .sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = directMessageCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.recipient_id === auth.userId) {
    return NextResponse.json({ error: "Kendinize mesaj gönderemezsiniz" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: recipient } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", parsed.data.recipient_id)
    .single();
  if (!recipient) return NextResponse.json({ error: "Hedef kullanıcı bulunamadı" }, { status: 404 });

  if (parsed.data.parent_id) {
    const { data: parent, error: parentError } = await supabase
      .from("direct_messages")
      .select("sender_id, recipient_id")
      .eq("id", parsed.data.parent_id)
      .single();
    if (parentError && isMissingTableError(parentError, "direct_messages")) {
      const virtualParent = await listVirtualRows<DirectMessageRow>(supabase, VIRTUAL_TABLE, {
        eq: { id: parsed.data.parent_id },
        limit: 2000,
      });
      const p = virtualParent[0];
      if (!p) return NextResponse.json({ error: "Yanıt mesajı bulunamadı" }, { status: 404 });
      const allowed =
        (p.sender_id === auth.userId && p.recipient_id === parsed.data.recipient_id)
        || (p.sender_id === parsed.data.recipient_id && p.recipient_id === auth.userId);
      if (!allowed) return NextResponse.json({ error: "Yanıt mesajı bu konuşmaya ait değil" }, { status: 400 });
    } else {
      if (!parent) return NextResponse.json({ error: "Yanıt mesajı bulunamadı" }, { status: 404 });

      const allowed =
        (parent.sender_id === auth.userId && parent.recipient_id === parsed.data.recipient_id)
        || (parent.sender_id === parsed.data.recipient_id && parent.recipient_id === auth.userId);

      if (!allowed) {
        return NextResponse.json({ error: "Yanıt mesajı bu konuşmaya ait değil" }, { status: 400 });
      }
    }
  }

  const insertData = {
    sender_id: auth.userId,
    recipient_id: parsed.data.recipient_id,
    parent_id: parsed.data.parent_id ?? null,
    message: parsed.data.message.trim(),
  };

  const { data, error } = await supabase
    .from("direct_messages")
    .insert(insertData)
    .select(`
      *,
      sender:profiles!direct_messages_sender_id_fkey(id, full_name, role),
      recipient:profiles!direct_messages_recipient_id_fkey(id, full_name, role)
    `)
    .single();

  if (error && isMissingTableError(error, "direct_messages")) {
    const virtual = await insertVirtualRow<DirectMessageRow>(supabase, VIRTUAL_TABLE, auth.userId, {
      sender_id: auth.userId,
      recipient_id: parsed.data.recipient_id,
      parent_id: parsed.data.parent_id ?? null,
      message: parsed.data.message.trim(),
      read_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as DirectMessageRow);

    await supabase.from("notifications").insert({
      user_id: parsed.data.recipient_id,
      title: "Yeni Direkt Mesaj",
      body: `${auth.fullName || "Bir kullanıcı"}: ${parsed.data.message.trim().slice(0, 140)}`,
      type: "direct_message",
      ref_id: virtual.id,
    });

    return NextResponse.json(virtual, { status: 201 });
  }
  if (error || !data) return NextResponse.json({ error: error?.message || "Mesaj gönderilemedi" }, { status: 500 });

  await supabase.from("notifications").insert({
    user_id: parsed.data.recipient_id,
    title: "Yeni Direkt Mesaj",
    body: `${auth.fullName || "Bir kullanıcı"}: ${parsed.data.message.trim().slice(0, 140)}`,
    type: "direct_message",
    ref_id: data.id,
  });

  await supabase.from("audit_logs").insert({
    user_id: auth.userId,
    action: "INSERT",
    table_name: "direct_messages",
    record_id: data.id,
    old_data: null,
    new_data: data,
  });

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  let body: { counterpart_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.counterpart_id) {
    return NextResponse.json({ error: "counterpart_id zorunlu" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("direct_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", auth.userId)
    .eq("sender_id", body.counterpart_id)
    .is("read_at", null)
    .select("id");

  if (error) {
    if (isMissingTableError(error, "direct_messages")) {
      const rows = await listVirtualRows<DirectMessageRow>(supabase, VIRTUAL_TABLE, { limit: 10000 });
      const unread = rows.filter(
        (r) => r.recipient_id === auth.userId && r.sender_id === body.counterpart_id && !r.read_at
      );
      await Promise.all(
        unread.map((row) =>
          updateVirtualRow<DirectMessageRow>(supabase, VIRTUAL_TABLE, auth.userId, row.id, { read_at: new Date().toISOString() })
        )
      );
      return NextResponse.json({ success: true, count: unread.length });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, count: (data ?? []).length });
}
