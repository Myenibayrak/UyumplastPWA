import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/auth/guards";
import { canCreateStock, canViewStock } from "@/lib/rbac";
import {
  TAPE_STOCK_PRESETS,
  buildTapeGroupNotes,
  extractTapeGroupFromNotes,
  getTapePresetGroups,
  getTapeProductsByGroup,
} from "@/lib/tape-stock";

type StockRow = {
  id: string;
  product: string;
  quantity: number | null;
  notes: string | null;
};

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .trim();
}

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canViewStock(auth.role, auth.fullName) && !canCreateStock(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    groups: getTapePresetGroups().map((group) => ({
      group,
      items: getTapeProductsByGroup(group),
      total: getTapeProductsByGroup(group).reduce((sum, item) => sum + item.quantity, 0),
    })),
    total: TAPE_STOCK_PRESETS.reduce((sum, item) => sum + item.quantity, 0),
  });
}

export async function POST(_request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (!canCreateStock(auth.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data: existingRows, error: existingError } = await supabase
    .from("stock_items")
    .select("id, product, quantity, notes")
    .eq("category", "tape");

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  const rows = (existingRows ?? []) as StockRow[];
  const byProduct = new Map<string, StockRow[]>();
  const byComposite = new Map<string, StockRow>();

  for (const row of rows) {
    const productKey = normalize(row.product);
    const list = byProduct.get(productKey) ?? [];
    list.push(row);
    byProduct.set(productKey, list);

    const group = extractTapeGroupFromNotes(row.notes);
    if (group) {
      byComposite.set(`${normalize(group)}::${productKey}`, row);
    }
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let movementCount = 0;

  for (const preset of TAPE_STOCK_PRESETS) {
    const productKey = normalize(preset.product);
    const compositeKey = `${normalize(preset.group)}::${productKey}`;
    const noteValue = buildTapeGroupNotes(preset.group, null);

    let existing = byComposite.get(compositeKey);
    if (!existing) {
      const candidates = byProduct.get(productKey) ?? [];
      if (candidates.length === 1) {
        existing = candidates[0];
      }
    }

    if (!existing) {
      const { data: inserted, error: insertError } = await supabase
        .from("stock_items")
        .insert({
          category: "tape",
          product: preset.product,
          micron: null,
          width: null,
          kg: 0,
          quantity: preset.quantity,
          lot_no: null,
          notes: noteValue,
        })
        .select()
        .single();

      if (insertError || !inserted) {
        return NextResponse.json({ error: insertError?.message || "Bant stokları yüklenemedi" }, { status: 500 });
      }

      created += 1;
      movementCount += 1;

      const { error: movementError } = await supabase.from("stock_movements").insert({
        stock_item_id: inserted.id,
        movement_type: "in",
        kg: 0,
        quantity: Number(inserted.quantity || 0),
        reason: "tape_preset_seed",
        reference_type: "stock_item",
        reference_id: inserted.id,
        notes: "Bant hazır listesi ile ilk yükleme",
        created_by: auth.userId,
      });
      if (movementError) {
        return NextResponse.json({ error: movementError.message }, { status: 500 });
      }

      const { error: auditError } = await supabase.from("audit_logs").insert({
        user_id: auth.userId,
        action: "INSERT",
        table_name: "stock_items",
        record_id: inserted.id,
        old_data: null,
        new_data: inserted,
      });
      if (auditError) {
        return NextResponse.json({ error: auditError.message }, { status: 500 });
      }

      continue;
    }

    const beforeQty = Number(existing.quantity || 0);
    const diff = preset.quantity - beforeQty;
    const patchedNotes = buildTapeGroupNotes(preset.group, existing.notes);

    if (diff === 0 && patchedNotes === (existing.notes || "")) {
      unchanged += 1;
      continue;
    }

    const { data: updatedRow, error: updateError } = await supabase
      .from("stock_items")
      .update({ quantity: preset.quantity, notes: patchedNotes })
      .eq("id", existing.id)
      .select()
      .single();

    if (updateError || !updatedRow) {
      return NextResponse.json({ error: updateError?.message || "Bant stokları güncellenemedi" }, { status: 500 });
    }

    updated += 1;

    if (diff !== 0) {
      movementCount += 1;
      const { error: movementError } = await supabase.from("stock_movements").insert({
        stock_item_id: existing.id,
        movement_type: diff > 0 ? "in" : "out",
        kg: 0,
        quantity: Math.abs(diff),
        reason: "tape_preset_sync",
        reference_type: "stock_item",
        reference_id: existing.id,
        notes: "Bant hazır listesi ile eşitleme",
        created_by: auth.userId,
      });
      if (movementError) {
        return NextResponse.json({ error: movementError.message }, { status: 500 });
      }
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({
      user_id: auth.userId,
      action: "UPDATE",
      table_name: "stock_items",
      record_id: existing.id,
      old_data: existing,
      new_data: updatedRow,
    });
    if (auditError) {
      return NextResponse.json({ error: auditError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    summary: {
      totalPresets: TAPE_STOCK_PRESETS.length,
      created,
      updated,
      unchanged,
      movements: movementCount,
    },
  });
}
