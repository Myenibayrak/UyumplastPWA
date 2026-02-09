"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getPaginationRowModel, flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import type { StockItem, StockCategory, AppRole, StockMovement } from "@/lib/types";
import { STOCK_CATEGORY_LABELS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUpDown, ChevronLeft, ChevronRight, Plus, Loader2, Trash2, Package, FilterX, Database } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { canCreateStock, canEditStock, canViewStock, resolveRoleByIdentity } from "@/lib/rbac";
import { buildTapeGroupNotes, extractTapeGroupFromNotes } from "@/lib/tape-stock";

type StockMovementRow = StockMovement & {
  stock_item?: Pick<StockItem, "category" | "product" | "micron" | "width" | "lot_no"> | null;
  creator?: { full_name?: string | null } | null;
};

type BulkStockRow = {
  key: string;
  tape_group: string;
  product: string;
  micron: string;
  width: string;
  kg: string;
  quantity: string;
  lot_no: string;
  notes: string;
};

function createBulkRow(): BulkStockRow {
  return {
    key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    tape_group: "",
    product: "",
    micron: "",
    width: "",
    kg: "",
    quantity: "",
    lot_no: "",
    notes: "",
  };
}

function InlineStockCell({ value, field, itemId, type = "text", onSaved }: {
  value: string | number | null;
  field: string;
  itemId: string;
  type?: "text" | "number";
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value ?? ""));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setVal(String(value ?? "")); }, [value]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const save = useCallback(async () => {
    if (String(value ?? "") === val) { setEditing(false); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (type === "number") payload[field] = val === "" ? null : Number(val);
      else payload[field] = val || null;
      const res = await fetch(`/api/stock/${itemId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Kayıt hatası");
      onSaved();
    } catch { toast({ title: "Hata", variant: "destructive" }); }
    finally { setSaving(false); setEditing(false); }
  }, [val, value, field, itemId, type, onSaved]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") { setVal(String(value ?? "")); setEditing(false); }
    if (e.key === "Tab") { e.preventDefault(); save(); }
  };

  if (saving) return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;

  if (!editing) {
    return (
      <div
        className="min-h-[28px] px-1 py-0.5 rounded cursor-text hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 transition-all flex items-center"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      >
        <span className={val ? "" : "text-muted-foreground text-xs"}>{val || "—"}</span>
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type={type === "number" ? "number" : "text"}
      className="w-full h-7 text-xs border rounded px-1 bg-white focus:ring-2 focus:ring-blue-300 outline-none"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      step={type === "number" ? "0.01" : undefined}
    />
  );
}

export default function StockPage() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [category, setCategory] = useState<StockCategory>("film");
  const [role, setRole] = useState<AppRole | null>(null);
  const [fullName, setFullName] = useState<string>("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newItem, setNewItem] = useState({
    tape_group: "",
    product: "",
    micron: "",
    width: "",
    kg: "",
    quantity: "",
    lot_no: "",
    notes: "",
  });
  const [addLoading, setAddLoading] = useState(false);
  const [tapeSyncLoading, setTapeSyncLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkStockRow[]>([createBulkRow()]);
  const [bulkPaste, setBulkPaste] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [tapePresetItems, setTapePresetItems] = useState<Array<{ group: string; product: string; quantity: number }>>([]);
  const [tapeGroups, setTapeGroups] = useState<string[]>([]);

  const [fProduct, setFProduct] = useState("");
  const [fTapeGroup, setFTapeGroup] = useState("");
  const [fMicronMin, setFMicronMin] = useState("");
  const [fMicronMax, setFMicronMax] = useState("");
  const [fWidthMin, setFWidthMin] = useState("");
  const [fWidthMax, setFWidthMax] = useState("");

  const canView = canViewStock(role, fullName);
  const canEdit = canView && canEditStock(role);
  const canCreate = canCreateStock(role);

  const hasActiveFilters = fProduct || fTapeGroup || fMicronMin || fMicronMax || fWidthMin || fWidthMax;

  function clearFilters() {
    setFProduct("");
    setFTapeGroup("");
    setFMicronMin("");
    setFMicronMax("");
    setFWidthMin("");
    setFWidthMax("");
    setGlobalFilter("");
  }

  const loadStock = useCallback(async () => {
    if (!canView) {
      setItems([]);
      setMovements([]);
      setProducts([]);
      return;
    }
    const [stockRes, movementRes] = await Promise.all([
      fetch(`/api/stock?category=${category}`),
      fetch(`/api/stock-movements?category=${category}&limit=80`),
    ]);

    if (stockRes.ok) {
      const data: StockItem[] = await stockRes.json();
      setItems(data);
      const uniqueProducts = Array.from(new Set(data.map((d) => d.product))).sort();
      setProducts(uniqueProducts);
    }
    if (movementRes.ok) {
      const moveData: StockMovementRow[] = await movementRes.json();
      setMovements(moveData);
    }
  }, [category, canView]);

  const loadTapePresets = useCallback(async () => {
    if (!canView && !canCreate) return;
    const res = await fetch("/api/stock/tape-presets", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const groups = (data?.groups ?? []) as Array<{ group: string; items: Array<{ group: string; product: string; quantity: number }> }>;
    const flat = groups.flatMap((g) => g.items);
    setTapePresetItems(flat);
    setTapeGroups(groups.map((g) => g.group));
  }, [canCreate, canView]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role, full_name").eq("id", user.id).single();
      if (profile) {
        const resolved = resolveRoleByIdentity(profile.role as AppRole, profile.full_name || "");
        if (resolved) setRole(resolved);
        setFullName(profile.full_name || "");
      }
    });
  }, []);

  useEffect(() => { loadStock(); }, [loadStock]);
  useEffect(() => {
    if (category === "tape") loadTapePresets();
  }, [category, loadTapePresets]);
  useEffect(() => {
    setNewItem({ tape_group: "", product: "", micron: "", width: "", kg: "", quantity: "", lot_no: "", notes: "" });
    setBulkRows([createBulkRow()]);
    setBulkPaste("");
    setFTapeGroup("");
  }, [category]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (fProduct && !item.product.toLowerCase().includes(fProduct.toLowerCase())) return false;
      if (category === "tape" && fTapeGroup) {
        const group = extractTapeGroupFromNotes(item.notes);
        if (group !== fTapeGroup) return false;
      }
      if (fMicronMin && (item.micron == null || item.micron < Number(fMicronMin))) return false;
      if (fMicronMax && (item.micron == null || item.micron > Number(fMicronMax))) return false;
      if (fWidthMin && (item.width == null || item.width < Number(fWidthMin))) return false;
      if (fWidthMax && (item.width == null || item.width > Number(fWidthMax))) return false;
      return true;
    });
  }, [items, fProduct, category, fTapeGroup, fMicronMin, fMicronMax, fWidthMin, fWidthMax]);

  async function handleAdd() {
    if (!newItem.product) return;
    setAddLoading(true);
    try {
      const notes = category === "tape"
        ? buildTapeGroupNotes(newItem.tape_group || "Diger", newItem.notes || null)
        : (newItem.notes || null);
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          product: newItem.product,
          micron: category === "tape" ? null : (newItem.micron ? Number(newItem.micron) : null),
          width: category === "tape" ? null : (newItem.width ? Number(newItem.width) : null),
          kg: category === "tape" ? 0 : (newItem.kg ? Number(newItem.kg) : 0),
          quantity: newItem.quantity ? Number(newItem.quantity) : 0,
          lot_no: newItem.lot_no || null,
          notes,
        }),
      });
      if (!res.ok) throw new Error("Ekleme hatası");
      toast({ title: "Stok eklendi" });
      setNewItem({ tape_group: "", product: "", micron: "", width: "", kg: "", quantity: "", lot_no: "", notes: "" });
      setAddOpen(false);
      loadStock();
    } catch { toast({ title: "Hata", variant: "destructive" }); }
    finally { setAddLoading(false); }
  }

  async function syncTapePresets() {
    if (category !== "tape") return;
    setTapeSyncLoading(true);
    try {
      const res = await fetch("/api/stock/tape-presets", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Bant listesi uygulanamadı");

      toast({
        title: "Bant stokları eşitlendi",
        description: `Yeni: ${body?.summary?.created || 0}, Güncellenen: ${body?.summary?.updated || 0}`,
      });
      await Promise.all([loadStock(), loadTapePresets()]);
    } catch (err) {
      toast({
        title: "Hata",
        description: err instanceof Error ? err.message : "Bant listesi eşitlenemedi",
        variant: "destructive",
      });
    } finally {
      setTapeSyncLoading(false);
    }
  }

  function patchBulkRow(key: string, field: keyof BulkStockRow, value: string) {
    setBulkRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  function addBulkRow() {
    setBulkRows((prev) => [...prev, createBulkRow()]);
  }

  function removeBulkRow(key: string) {
    setBulkRows((prev) => {
      const next = prev.filter((r) => r.key !== key);
      return next.length > 0 ? next : [createBulkRow()];
    });
  }

  function applyBulkPaste() {
    const lines = bulkPaste
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const mapped = lines.map((line) => {
      const cols = line.split(/\t|;/).map((c) => c.trim());
      if (category === "tape") {
        return {
          key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          tape_group: cols[0] || "",
          product: cols[1] || "",
          micron: "",
          width: "",
          kg: "0",
          quantity: cols[2] || "",
          lot_no: "",
          notes: cols[3] || "",
        } as BulkStockRow;
      }

      return {
        key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        tape_group: "",
        product: cols[0] || "",
        micron: cols[1] || "",
        width: cols[2] || "",
        kg: cols[3] || "",
        quantity: cols[4] || "",
        lot_no: cols[5] || "",
        notes: cols[6] || "",
      } as BulkStockRow;
    });
    setBulkRows(mapped.length > 0 ? mapped : [createBulkRow()]);
  }

  async function handleBulkSave() {
    const rows = bulkRows.filter((r) => r.product.trim().length > 0);
    if (rows.length === 0) {
      toast({ title: "Kaydedilecek satır yok", variant: "destructive" });
      return;
    }

    const payload: Array<Record<string, unknown>> = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const quantity = row.quantity.trim() === "" ? 0 : Number(row.quantity);

      if (!Number.isFinite(quantity)) {
        toast({ title: `Satır ${i + 1} hatalı`, description: "Adet sayısal olmalı", variant: "destructive" });
        return;
      }

      if (category === "tape") {
        payload.push({
          category,
          product: row.product.trim(),
          micron: null,
          width: null,
          kg: 0,
          quantity,
          lot_no: row.lot_no.trim() || null,
          notes: buildTapeGroupNotes(row.tape_group || "Diger", row.notes.trim() || null),
        });
      } else {
        const kg = row.kg.trim() === "" ? 0 : Number(row.kg);
        const micron = row.micron.trim() === "" ? null : Number(row.micron);
        const width = row.width.trim() === "" ? null : Number(row.width);

        if (!Number.isFinite(kg)) {
          toast({ title: `Satır ${i + 1} hatalı`, description: "Kg sayısal olmalı", variant: "destructive" });
          return;
        }
        if ((micron !== null && !Number.isFinite(micron)) || (width !== null && !Number.isFinite(width))) {
          toast({ title: `Satır ${i + 1} hatalı`, description: "Mikron/En sayısal olmalı", variant: "destructive" });
          return;
        }

        payload.push({
          category,
          product: row.product.trim(),
          micron,
          width,
          kg,
          quantity,
          lot_no: row.lot_no.trim() || null,
          notes: row.notes.trim() || null,
        });
      }
    }

    setBulkLoading(true);
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Toplu stok kaydı başarısız");
      }
      toast({ title: `${payload.length} satır stok kaydedildi` });
      setBulkRows([createBulkRow()]);
      setBulkPaste("");
      await loadStock();
    } catch (err) {
      toast({
        title: "Hata",
        description: err instanceof Error ? err.message : "Toplu kayıt sırasında hata oluştu",
        variant: "destructive",
      });
    } finally {
      setBulkLoading(false);
    }
  }

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/stock/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "Silindi" }); loadStock(); }
    else toast({ title: "Hata", variant: "destructive" });
  }, [loadStock]);

  const filteredKg = useMemo(() => filteredItems.reduce((s, i) => s + (i.kg || 0), 0), [filteredItems]);
  const filteredQty = useMemo(() => filteredItems.reduce((s, i) => s + (i.quantity || 0), 0), [filteredItems]);

  const columns = useMemo<ColumnDef<StockItem>[]>(() => {
    const cols: ColumnDef<StockItem>[] = [
      ...(category === "tape"
        ? [{
            id: "tape_group",
            header: "Kategori",
            cell: ({ row }: { row: { original: StockItem } }) => {
              const group = extractTapeGroupFromNotes(row.original.notes) || "Diger";
              return <span>{group}</span>;
            },
            size: 120,
          } as ColumnDef<StockItem>]
        : []),
      {
        accessorKey: "product",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-7 text-xs px-1" onClick={() => column.toggleSorting()}>
            Ürün <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => canEdit ? (
          <InlineStockCell value={row.original.product} field="product" itemId={row.original.id} onSaved={loadStock} />
        ) : <span className="font-medium">{row.original.product}</span>,
        size: 160,
      },
      ...(category !== "tape"
        ? [
            {
              accessorKey: "micron",
              header: ({ column }: { column: { toggleSorting: () => void } }) => (
                <Button variant="ghost" size="sm" className="h-7 text-xs px-1" onClick={() => column.toggleSorting()}>
                  Mikron <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              ),
              cell: ({ row }: { row: { original: StockItem } }) => canEdit ? (
                <InlineStockCell value={row.original.micron} field="micron" itemId={row.original.id} type="number" onSaved={loadStock} />
              ) : (row.original.micron ?? "—"),
              size: 80,
            },
            {
              accessorKey: "width",
              header: ({ column }: { column: { toggleSorting: () => void } }) => (
                <Button variant="ghost" size="sm" className="h-7 text-xs px-1" onClick={() => column.toggleSorting()}>
                  En (mm) <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              ),
              cell: ({ row }: { row: { original: StockItem } }) => canEdit ? (
                <InlineStockCell value={row.original.width} field="width" itemId={row.original.id} type="number" onSaved={loadStock} />
              ) : (row.original.width ?? "—"),
              size: 90,
            },
            {
              accessorKey: "kg",
              header: ({ column }: { column: { toggleSorting: () => void } }) => (
                <Button variant="ghost" size="sm" className="h-7 text-xs px-1" onClick={() => column.toggleSorting()}>
                  Kg <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              ),
              cell: ({ row }: { row: { original: StockItem } }) => canEdit ? (
                <InlineStockCell value={row.original.kg} field="kg" itemId={row.original.id} type="number" onSaved={loadStock} />
              ) : <span className="font-semibold">{row.original.kg?.toLocaleString("tr-TR")}</span>,
              size: 90,
            },
          ]
        : []),
      {
        accessorKey: "quantity",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-7 text-xs px-1" onClick={() => column.toggleSorting()}>
            Adet <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => canEdit ? (
          <InlineStockCell value={row.original.quantity} field="quantity" itemId={row.original.id} type="number" onSaved={loadStock} />
        ) : <span>{row.original.quantity}</span>,
        size: 70,
      },
      {
        accessorKey: "lot_no",
        header: "Lot No",
        cell: ({ row }) => canEdit ? (
          <InlineStockCell value={row.original.lot_no} field="lot_no" itemId={row.original.id} onSaved={loadStock} />
        ) : (row.original.lot_no ?? "—"),
        size: 80,
      },
      {
        accessorKey: "notes",
        header: "Not",
        cell: ({ row }) => canEdit ? (
          <InlineStockCell value={row.original.notes} field="notes" itemId={row.original.id} onSaved={loadStock} />
        ) : (row.original.notes ?? "—"),
        size: 140,
      },
    ];

    if (canEdit) {
      cols.push({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDelete(row.original.id)}>
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        ),
        size: 40,
      });
    }

    return cols;
  }, [category, canEdit, loadStock, handleDelete]);

  const table = useReactTable({
    data: filteredItems,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 100 } },
  });

  return (
    <div className="space-y-4">
      {role && !canView && !canCreate ? (
        <div className="max-w-3xl mx-auto bg-white rounded-lg border border-slate-200 p-8 text-center">
          <h1 className="text-xl font-semibold text-slate-900 mb-2">Stok Erişimi Yok</h1>
          <p className="text-sm text-slate-600">
            Stok görünümü sadece satış, fabrika müdürü, Muhammed ve Mustafa için açıktır.
          </p>
        </div>
      ) : (
        <>
	      <div className="flex items-center gap-3 flex-wrap">
	        <Package className="h-5 w-5 text-blue-600" />
	        <h1 className="text-xl font-bold">Stok Yönetimi</h1>
        <Tabs value={category} onValueChange={(v) => setCategory(v as StockCategory)} className="ml-4">
          <TabsList>
            <TabsTrigger value="film">Film Stoğu</TabsTrigger>
            <TabsTrigger value="tape">Bant Stoğu</TabsTrigger>
          </TabsList>
        </Tabs>
	      </div>

	      {!canView && canCreate && (
	        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
	          Sadece giriş modu: yeni stok kartı ekleyebilir ve toplu stok girişi yapabilirsiniz. Mevcut stok listesi görünmez.
	        </div>
	      )}

	      {canView && (
	        <div className="rounded-lg border bg-white shadow-sm p-3 space-y-3">
	          <div className={`grid grid-cols-2 ${category === "tape" ? "md:grid-cols-4" : "md:grid-cols-6"} gap-2 items-end`}>
	            <div className="space-y-1">
	              <Label className="text-[10px] font-semibold text-gray-500 uppercase">Ürün (içerir)</Label>
	              <Select value={fProduct || "__all__"} onValueChange={(v) => setFProduct(v === "__all__" ? "" : v)}>
	                <SelectTrigger className="h-8 text-xs">
	                  <SelectValue placeholder="Tümü" />
	                </SelectTrigger>
	                <SelectContent>
	                  <SelectItem value="__all__">Tümü</SelectItem>
	                  {products.map((p) => (
	                    <SelectItem key={p} value={p}>{p}</SelectItem>
	                  ))}
	                </SelectContent>
	              </Select>
	            </div>

          {category === "tape" ? (
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-gray-500 uppercase">Kategori</Label>
              <Select value={fTapeGroup || "__all__"} onValueChange={(v) => setFTapeGroup(v === "__all__" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Tümü" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Tümü</SelectItem>
                  {tapeGroups.map((group) => (
                    <SelectItem key={group} value={group}>{group}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-gray-500 uppercase">Mikron ≥</Label>
                <Input type="number" className="h-8 text-xs" placeholder="min" value={fMicronMin} onChange={(e) => setFMicronMin(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-gray-500 uppercase">Mikron ≤</Label>
                <Input type="number" className="h-8 text-xs" placeholder="max" value={fMicronMax} onChange={(e) => setFMicronMax(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-gray-500 uppercase">En ≥</Label>
                <Input type="number" className="h-8 text-xs" placeholder="min" value={fWidthMin} onChange={(e) => setFWidthMin(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-gray-500 uppercase">En ≤</Label>
                <Input type="number" className="h-8 text-xs" placeholder="max" value={fWidthMax} onChange={(e) => setFWidthMax(e.target.value)} />
              </div>
            </>
          )}

              <div className="flex gap-1">
            {category === "tape" && canCreate && (
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={syncTapePresets} disabled={tapeSyncLoading}>
                <Database className={`h-3 w-3 mr-1 ${tapeSyncLoading ? "animate-spin" : ""}`} />
                Hazır Listeyi Uygula
              </Button>
            )}
            {hasActiveFilters && (
              <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={clearFilters}>
                <FilterX className="h-3 w-3 mr-1" /> Temizle
              </Button>
            )}
            {canCreate && (
              <Button size="sm" className="h-8 text-xs" onClick={() => setAddOpen(true)}>
                <Plus className="h-3 w-3 mr-1" /> Ekle
              </Button>
            )}
          </div>
        </div>

	        <div className="flex items-center gap-3 text-xs">
	          <span className="text-muted-foreground">{table.getFilteredRowModel().rows.length} kayıt</span>
	          {category !== "tape" && <span className="font-bold text-lg text-red-600">{filteredKg.toLocaleString("tr-TR")} kg</span>}
	          <span className="font-semibold text-green-700">{filteredQty.toLocaleString("tr-TR")} adet</span>
	          {hasActiveFilters && <span className="text-orange-600 font-medium">(filtreli)</span>}
	        </div>
	      </div>
	      )}

	      {canCreate && (
	        <div className="rounded-lg border bg-white shadow-sm p-3 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Hızlı Blok Giriş (Excel Benzeri)</h2>
              <p className="text-xs text-slate-500">
                {category === "tape"
                  ? "Kolon sırası (Bant): Kategori | Cins | Miktar | Not"
                  : "Kolon sırası (Film): Ürün | Mikron | En | Kg | Adet | Lot No | Not"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={addBulkRow}>
                Satır Ekle
              </Button>
              <Button type="button" size="sm" className="h-8 text-xs" onClick={handleBulkSave} disabled={bulkLoading}>
                {bulkLoading ? "Kaydediliyor..." : "Toplu Kaydet"}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Excel/Yapıştırma Alanı (tab veya `;` ayrılmış)</Label>
            <Textarea
              value={bulkPaste}
              onChange={(e) => setBulkPaste(e.target.value)}
              placeholder={category === "tape"
                ? "Kapak Banti\tOPP Sag\t714\tSayim girisi"
                : "PE\t35\t150\t120\t3\tLOT-001\tAçıklama"}
              className="min-h-[70px] text-xs"
            />
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={applyBulkPaste}>
                Yapıştırmayı Satırlara Dağıt
              </Button>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-50">
                <tr>
                  {category === "tape" && <th className="px-2 py-2 text-left border">Kategori</th>}
                  <th className="px-2 py-2 text-left border">Ürün</th>
                  {category !== "tape" && <th className="px-2 py-2 text-left border">Mikron</th>}
                  {category !== "tape" && <th className="px-2 py-2 text-left border">En</th>}
                  {category !== "tape" && <th className="px-2 py-2 text-left border">Kg</th>}
                  <th className="px-2 py-2 text-left border">Adet</th>
                  {category !== "tape" && <th className="px-2 py-2 text-left border">Lot No</th>}
                  <th className="px-2 py-2 text-left border">Not</th>
                  <th className="px-2 py-2 text-left border w-10">-</th>
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((row, idx) => (
                  <tr key={row.key}>
                    {category === "tape" && (
                      <td className="border p-1">
                        <Input className="h-8 text-xs" value={row.tape_group} onChange={(e) => patchBulkRow(row.key, "tape_group", e.target.value)} placeholder="Kategori" />
                      </td>
                    )}
                    <td className="border p-1"><Input className="h-8 text-xs" value={row.product} onChange={(e) => patchBulkRow(row.key, "product", e.target.value)} placeholder={`Satır ${idx + 1}`} /></td>
                    {category !== "tape" && <td className="border p-1"><Input className="h-8 text-xs" value={row.micron} onChange={(e) => patchBulkRow(row.key, "micron", e.target.value)} type="number" /></td>}
                    {category !== "tape" && <td className="border p-1"><Input className="h-8 text-xs" value={row.width} onChange={(e) => patchBulkRow(row.key, "width", e.target.value)} type="number" /></td>}
                    {category !== "tape" && <td className="border p-1"><Input className="h-8 text-xs" value={row.kg} onChange={(e) => patchBulkRow(row.key, "kg", e.target.value)} type="number" /></td>}
                    <td className="border p-1"><Input className="h-8 text-xs" value={row.quantity} onChange={(e) => patchBulkRow(row.key, "quantity", e.target.value)} type="number" /></td>
                    {category !== "tape" && <td className="border p-1"><Input className="h-8 text-xs" value={row.lot_no} onChange={(e) => patchBulkRow(row.key, "lot_no", e.target.value)} /></td>}
                    <td className="border p-1"><Input className="h-8 text-xs" value={row.notes} onChange={(e) => patchBulkRow(row.key, "notes", e.target.value)} /></td>
                    <td className="border p-1 text-center">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeBulkRow(row.key)}>
                        <Trash2 className="h-3 w-3 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

	      {canView && (
	        <div className="space-y-3">
	          <div className="md:hidden rounded-lg border bg-white shadow-sm divide-y">
	            {table.getRowModel().rows.length === 0 ? (
	              <div className="px-4 py-10 text-center text-muted-foreground text-sm">
	                {STOCK_CATEGORY_LABELS[category]} kaydı yok
	              </div>
	            ) : (
	              table.getRowModel().rows.map((row) => {
	                const item = row.original;
	                const tapeGroup = extractTapeGroupFromNotes(item.notes) || "Diger";
	                return (
	                  <div key={row.id} className="p-3 space-y-1.5">
	                    <div className="flex items-start justify-between gap-2">
	                      <div>
	                        <p className="text-sm font-semibold text-slate-900">{item.product}</p>
	                        <p className="text-xs text-slate-500">
	                          {category === "tape"
	                            ? `Kategori: ${tapeGroup}`
	                            : `${item.micron ?? "—"}µ • ${item.width ?? "—"}mm`}
	                        </p>
	                      </div>
	                      {canEdit && (
	                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(item.id)}>
	                          <Trash2 className="h-3 w-3 text-destructive" />
	                        </Button>
	                      )}
	                    </div>
	                    <div className="flex flex-wrap gap-2 text-xs text-slate-600">
	                      <span>Kg: {Number(item.kg || 0).toLocaleString("tr-TR")}</span>
	                      <span>Adet: {Number(item.quantity || 0).toLocaleString("tr-TR")}</span>
	                      <span>Lot: {item.lot_no || "—"}</span>
	                    </div>
	                    {item.notes && <p className="text-xs text-slate-500">{item.notes}</p>}
	                  </div>
	                );
	              })
	            )}
	          </div>

	          <div className="hidden md:block rounded-lg border bg-white shadow-sm overflow-auto max-h-[calc(100vh-220px)]">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      {hg.headers.map((h) => (
                        <th key={h.id} className="px-2 py-2 text-left font-semibold text-gray-600 border-b border-r last:border-r-0 whitespace-nowrap"
                          style={{ width: h.column.getSize() }}
                        >
                          {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.length === 0 ? (
                    <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-muted-foreground text-sm">
                      {STOCK_CATEGORY_LABELS[category]} kaydı yok
                    </td></tr>
                  ) : (
                    table.getRowModel().rows.map((row, i) => (
                      <tr key={row.id} className={`border-b hover:bg-blue-50/50 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50/30"}`}>
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-2 py-1 border-r last:border-r-0">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
	              </table>
		        </div>
	        </div>
	      )}

	      {canView && (
	      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" className="h-7" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
          <ChevronLeft className="h-3 w-3" />
        </Button>
        <span className="text-xs text-muted-foreground">
          {table.getState().pagination.pageIndex + 1} / {table.getPageCount() || 1}
        </span>
        <Button variant="outline" size="sm" className="h-7" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          <ChevronRight className="h-3 w-3" />
        </Button>
	      </div>
	      )}

	      {canView && (
	        <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
	          <div className="px-4 py-3 border-b bg-gray-50">
	            <h2 className="text-sm font-semibold text-gray-700">Stok Hareket Geçmişi</h2>
	          </div>
            <div className="md:hidden divide-y">
              {movements.length === 0 ? (
                <div className="px-4 py-10 text-center text-muted-foreground">Hareket kaydı yok</div>
              ) : (
                movements.map((m) => (
                  <div key={m.id} className="p-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-slate-600">{new Date(m.created_at).toLocaleString("tr-TR")}</p>
                      <span className={m.movement_type === "in" ? "text-green-700 font-medium" : "text-red-700 font-medium"}>
                        {m.movement_type === "in" ? "Giriş" : "Çıkış"}
                      </span>
                    </div>
                    <p className="text-slate-700">
                      {m.stock_item?.product || "—"}
                      {m.stock_item?.micron ? ` ${m.stock_item.micron}µ` : ""}
                      {m.stock_item?.width ? ` ${m.stock_item.width}mm` : ""}
                    </p>
                    <div className="flex gap-2 text-slate-600">
                      <span>Kg: {Number(m.kg || 0).toLocaleString("tr-TR")}</span>
                      <span>Adet: {Number(m.quantity || 0).toLocaleString("tr-TR")}</span>
                    </div>
                    <p className="text-slate-500">Sebep: {m.reason}</p>
                    <p className="text-slate-500">Kullanıcı: {m.creator?.full_name || "—"}</p>
                  </div>
                ))
              )}
            </div>
	          <div className="hidden md:block max-h-[380px] overflow-auto">
	            <table className="w-full text-xs border-collapse">
	              <thead className="bg-gray-50 sticky top-0 z-10">
	                <tr>
	                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Tarih</th>
	                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Hareket</th>
	                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Ürün</th>
	                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Kg</th>
	                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Adet</th>
	                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Sebep</th>
	                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">Kullanıcı</th>
	                </tr>
	              </thead>
	              <tbody>
	                {movements.length === 0 ? (
	                  <tr>
	                    <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
	                      Hareket kaydı yok
	                    </td>
	                  </tr>
	                ) : (
	                  movements.map((m, i) => (
	                    <tr key={m.id} className={`border-b ${i % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}>
	                      <td className="px-3 py-2 whitespace-nowrap">
	                        {new Date(m.created_at).toLocaleString("tr-TR")}
	                      </td>
	                      <td className="px-3 py-2 whitespace-nowrap">
	                        <span className={m.movement_type === "in" ? "text-green-700 font-medium" : "text-red-700 font-medium"}>
	                          {m.movement_type === "in" ? "Giriş" : "Çıkış"}
	                        </span>
	                      </td>
	                      <td className="px-3 py-2">
	                        {m.stock_item?.product || "—"}
	                        {m.stock_item?.micron ? ` ${m.stock_item.micron}µ` : ""}
	                        {m.stock_item?.width ? ` ${m.stock_item.width}mm` : ""}
	                      </td>
	                      <td className="px-3 py-2">{Number(m.kg || 0).toLocaleString("tr-TR")}</td>
	                      <td className="px-3 py-2">{Number(m.quantity || 0).toLocaleString("tr-TR")}</td>
	                      <td className="px-3 py-2">{m.reason}</td>
	                      <td className="px-3 py-2">{m.creator?.full_name || "—"}</td>
	                    </tr>
	                  ))
	                )}
	              </tbody>
	            </table>
	          </div>
	        </div>
	      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni Stok Ekle — {STOCK_CATEGORY_LABELS[category]}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {category === "tape" && (
              <div className="space-y-1">
                <Label className="text-xs">Bant Kategorisi</Label>
                <Select
                  value={newItem.tape_group || "__none__"}
                  onValueChange={(v) => setNewItem((p) => ({ ...p, tape_group: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Kategori seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Seçilmedi</SelectItem>
                    {tapeGroups.map((group) => (
                      <SelectItem key={group} value={group}>{group}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Ürün *</Label>
              {category === "tape" ? (
                <Select
                  value={newItem.product || "__none__"}
                  onValueChange={(v) => {
                    if (v === "__none__") return;
                    const preset = tapePresetItems.find((item) =>
                      item.product === v && (!newItem.tape_group || item.group === newItem.tape_group)
                    );
                    setNewItem((p) => ({
                      ...p,
                      tape_group: preset?.group || p.tape_group,
                      product: v,
                      quantity: p.quantity || String(preset?.quantity ?? ""),
                    }));
                  }}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Hazır listeden seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {tapePresetItems
                      .filter((item) => !newItem.tape_group || item.group === newItem.tape_group)
                      .map((item) => (
                        <SelectItem key={`${item.group}:${item.product}`} value={item.product}>
                          {item.group} / {item.product}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Input className="h-8" value={newItem.product} onChange={(e) => setNewItem((p) => ({ ...p, product: e.target.value }))} placeholder="Ürün adı (manuel)" />
            </div>
            <div className={`grid ${category === "tape" ? "grid-cols-1" : "grid-cols-2"} gap-3`}>
              {category !== "tape" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Mikron</Label>
                    <Input className="h-8" type="number" value={newItem.micron} onChange={(e) => setNewItem((p) => ({ ...p, micron: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">En (mm)</Label>
                    <Input className="h-8" type="number" value={newItem.width} onChange={(e) => setNewItem((p) => ({ ...p, width: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Kg</Label>
                    <Input className="h-8" type="number" value={newItem.kg} onChange={(e) => setNewItem((p) => ({ ...p, kg: e.target.value }))} />
                  </div>
                </>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Adet</Label>
                <Input className="h-8" type="number" value={newItem.quantity} onChange={(e) => setNewItem((p) => ({ ...p, quantity: e.target.value }))} />
              </div>
              {category !== "tape" && (
                <div className="space-y-1">
                  <Label className="text-xs">Lot No</Label>
                  <Input className="h-8" value={newItem.lot_no} onChange={(e) => setNewItem((p) => ({ ...p, lot_no: e.target.value }))} />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Not</Label>
                <Input className="h-8" value={newItem.notes} onChange={(e) => setNewItem((p) => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <Button className="w-full" onClick={handleAdd} disabled={addLoading || !newItem.product}>
              {addLoading ? "Ekleniyor..." : "Ekle"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
        </>
      )}
    </div>
  );
}
