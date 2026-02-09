import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type JsonObject = Record<string, unknown>;

type AuditLogRow = {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: JsonObject | null;
  new_data: JsonObject | null;
  created_at: string;
};

type ListOptions = {
  eq?: Record<string, string | number | boolean | null | undefined>;
  limit?: number;
};

function rowMatches<T extends JsonObject>(
  row: T,
  eq?: Record<string, string | number | boolean | null | undefined>
): boolean {
  if (!eq) return true;
  return Object.entries(eq).every(([key, value]) => {
    if (value === undefined) return true;
    return (row[key] ?? null) === value;
  });
}

async function loadEvents(
  supabase: SupabaseClient,
  tableName: string,
  limit: number
): Promise<AuditLogRow[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, user_id, action, table_name, record_id, old_data, new_data, created_at")
    .eq("table_name", tableName)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as AuditLogRow[];
}

function reduceLatest<T extends JsonObject>(events: AuditLogRow[]): T[] {
  const state = new Map<string, T>();
  for (const event of events) {
    const id = event.record_id || String(event.new_data?.id || "");
    if (!id) continue;

    if (event.action === "DELETE") {
      state.delete(id);
      continue;
    }

    if (event.new_data) {
      state.set(id, ({ ...event.new_data, id } as unknown) as T);
    }
  }
  return Array.from(state.values());
}

export async function listVirtualRows<T extends JsonObject>(
  supabase: SupabaseClient,
  tableName: string,
  options: ListOptions = {}
): Promise<T[]> {
  const events = await loadEvents(supabase, tableName, options.limit ?? 5000);
  const rows = reduceLatest<T>(events);
  return rows.filter((r) => rowMatches(r, options.eq));
}

export async function getVirtualRowById<T extends JsonObject>(
  supabase: SupabaseClient,
  tableName: string,
  id: string
): Promise<T | null> {
  const rows = await listVirtualRows<T>(supabase, tableName, {
    eq: { id },
    limit: 8000,
  });
  return rows.find((r) => String(r.id || "") === id) ?? null;
}

export async function insertVirtualRow<T extends JsonObject>(
  supabase: SupabaseClient,
  tableName: string,
  userId: string,
  row: T
): Promise<T> {
  const now = new Date().toISOString();
  const payload = {
    id: String(row.id || randomUUID()),
    created_at: String(row.created_at || now),
    updated_at: String(row.updated_at || now),
    ...row,
  } as T & { id: string };

  const { error } = await supabase.from("audit_logs").insert({
    user_id: userId,
    action: "INSERT",
    table_name: tableName,
    record_id: payload.id,
    old_data: null,
    new_data: payload,
  });
  if (error) throw new Error(error.message);

  return payload;
}

export async function updateVirtualRow<T extends JsonObject>(
  supabase: SupabaseClient,
  tableName: string,
  userId: string,
  id: string,
  patch: Partial<T>
): Promise<T | null> {
  const current = await getVirtualRowById<T>(supabase, tableName, id);
  if (!current) return null;

  const next = {
    ...current,
    ...patch,
    id,
    updated_at: new Date().toISOString(),
  } as T;

  const { error } = await supabase.from("audit_logs").insert({
    user_id: userId,
    action: "UPDATE",
    table_name: tableName,
    record_id: id,
    old_data: current,
    new_data: next,
  });
  if (error) throw new Error(error.message);

  return next;
}

export async function deleteVirtualRow<T extends JsonObject>(
  supabase: SupabaseClient,
  tableName: string,
  userId: string,
  id: string
): Promise<T | null> {
  const current = await getVirtualRowById<T>(supabase, tableName, id);
  if (!current) return null;

  const { error } = await supabase.from("audit_logs").insert({
    user_id: userId,
    action: "DELETE",
    table_name: tableName,
    record_id: id,
    old_data: current,
    new_data: null,
  });
  if (error) throw new Error(error.message);

  return current;
}
