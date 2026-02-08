"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getPaginationRowModel, flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import type { StockItem, StockCategory, AppRole } from "@/lib/types";
import { STOCK_CATEGORY_LABELS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUpDown, ChevronLeft, ChevronRight, Plus, Loader2, Trash2, Package } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { canManageOrders } from "@/lib/rbac";

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
  const [category, setCategory] = useState<StockCategory>("film");
  const [role, setRole] = useState<AppRole | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newItem, setNewItem] = useState({ product: "", micron: "", width: "", kg: "", quantity: "" });
  const [addLoading, setAddLoading] = useState(false);
  const [products, setProducts] = useState<string[]>([]);

  const canEdit = role ? canManageOrders(role) || role === "warehouse" || role === "production" : false;

  const loadStock = useCallback(async () => {
    const res = await fetch(`/api/stock?category=${category}`);
    if (res.ok) {
      const data: StockItem[] = await res.json();
      setItems(data);
      const uniqueProducts = Array.from(new Set(data.map((d) => d.product))).sort();
      setProducts(uniqueProducts);
    }
  }, [category]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (profile) setRole(profile.role as AppRole);
    });
  }, []);

  useEffect(() => { loadStock(); }, [loadStock]);

  async function handleAdd() {
    if (!newItem.product) return;
    setAddLoading(true);
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          product: newItem.product,
          micron: newItem.micron ? Number(newItem.micron) : null,
          width: newItem.width ? Number(newItem.width) : null,
          kg: newItem.kg ? Number(newItem.kg) : 0,
          quantity: newItem.quantity ? Number(newItem.quantity) : 0,
        }),
      });
      if (!res.ok) throw new Error("Ekleme hatası");
      toast({ title: "Stok eklendi" });
      setNewItem({ product: "", micron: "", width: "", kg: "", quantity: "" });
      setAddOpen(false);
      loadStock();
    } catch { toast({ title: "Hata", variant: "destructive" }); }
    finally { setAddLoading(false); }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/stock/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "Silindi" }); loadStock(); }
    else toast({ title: "Hata", variant: "destructive" });
  }

  const totalKg = useMemo(() => items.reduce((s, i) => s + (i.kg || 0), 0), [items]);
  const totalQty = useMemo(() => items.reduce((s, i) => s + (i.quantity || 0), 0), [items]);

  const columns = useMemo<ColumnDef<StockItem>[]>(() => {
    const cols: ColumnDef<StockItem>[] = [
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
      {
        accessorKey: "micron",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-7 text-xs px-1" onClick={() => column.toggleSorting()}>
            Mikron <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => canEdit ? (
          <InlineStockCell value={row.original.micron} field="micron" itemId={row.original.id} type="number" onSaved={loadStock} />
        ) : (row.original.micron ?? "—"),
        size: 80,
      },
      {
        accessorKey: "width",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-7 text-xs px-1" onClick={() => column.toggleSorting()}>
            En (mm) <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => canEdit ? (
          <InlineStockCell value={row.original.width} field="width" itemId={row.original.id} type="number" onSaved={loadStock} />
        ) : (row.original.width ?? "—"),
        size: 90,
      },
      {
        accessorKey: "kg",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-7 text-xs px-1" onClick={() => column.toggleSorting()}>
            Kg <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => canEdit ? (
          <InlineStockCell value={row.original.kg} field="kg" itemId={row.original.id} type="number" onSaved={loadStock} />
        ) : <span className="font-semibold">{row.original.kg?.toLocaleString("tr-TR")}</span>,
        size: 90,
      },
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
  }, [canEdit, loadStock]);

  const table = useReactTable({
    data: items,
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

      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Ara... (ürün, mikron, en)"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span>{table.getFilteredRowModel().rows.length} kayıt</span>
          <span className="font-semibold text-blue-700">{totalKg.toLocaleString("tr-TR")} kg</span>
          <span className="font-semibold text-green-700">{totalQty.toLocaleString("tr-TR")} adet</span>
        </div>
        <div className="flex-1" />
        {products.length > 0 && (
          <div className="flex gap-1 flex-wrap max-w-md">
            {products.slice(0, 8).map((p) => (
              <Button key={p} variant={globalFilter === p ? "default" : "outline"} size="sm" className="h-6 text-[10px] px-2"
                onClick={() => setGlobalFilter(globalFilter === p ? "" : p)}
              >{p}</Button>
            ))}
            {products.length > 8 && <span className="text-xs text-muted-foreground self-center">+{products.length - 8}</span>}
          </div>
        )}
        {canEdit && (
          <Button size="sm" className="h-8" onClick={() => setAddOpen(true)}>
            <Plus className="h-3 w-3 mr-1" /> Ekle
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-white shadow-sm overflow-auto max-h-[calc(100vh-220px)]">
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

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni Stok Ekle — {STOCK_CATEGORY_LABELS[category]}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Ürün *</Label>
              <Input className="h-8" value={newItem.product} onChange={(e) => setNewItem((p) => ({ ...p, product: e.target.value }))} placeholder="Ürün adı" />
            </div>
            <div className="grid grid-cols-2 gap-3">
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
              <div className="space-y-1">
                <Label className="text-xs">Adet</Label>
                <Input className="h-8" type="number" value={newItem.quantity} onChange={(e) => setNewItem((p) => ({ ...p, quantity: e.target.value }))} />
              </div>
            </div>
            <Button className="w-full" onClick={handleAdd} disabled={addLoading || !newItem.product}>
              {addLoading ? "Ekleniyor..." : "Ekle"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
