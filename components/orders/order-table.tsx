"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getPaginationRowModel, flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import type { Order, OrderStatus, Priority, TaskSummary } from "@/lib/types";
import { ORDER_STATUS_LABELS, PRIORITY_LABELS, ROLE_LABELS, TASK_STATUS_LABELS } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowUpDown, ChevronLeft, ChevronRight, Plus, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface OrderTableProps {
  orders: Order[];
  showFinance: boolean;
  canEdit: boolean;
  onReload: () => void;
  onNewOrder: () => void;
  onAssignTask: (order: Order) => void;
}

function InlineCell({ value, field, orderId, type = "text", options, onSaved }: {
  value: string | number | null;
  field: string;
  orderId: string;
  type?: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value ?? ""));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => { setVal(String(value ?? "")); }, [value]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const save = useCallback(async () => {
    if (String(value ?? "") === val) { setEditing(false); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (type === "number") payload[field] = val === "" ? null : Number(val);
      else payload[field] = val || null;
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Kayıt hatası");
      onSaved();
    } catch { toast({ title: "Hata", variant: "destructive" }); }
    finally { setSaving(false); setEditing(false); }
  }, [val, value, field, orderId, type, onSaved]);

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
        <span className={val ? "" : "text-muted-foreground text-xs"}>
          {type === "date" && val ? new Date(val).toLocaleDateString("tr-TR") : val || "—"}
        </span>
      </div>
    );
  }

  if (type === "select" && options) {
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        className="w-full h-7 text-xs border rounded px-1 bg-white focus:ring-2 focus:ring-blue-300 outline-none"
        value={val}
        onChange={(e) => { setVal(e.target.value); }}
        onBlur={save}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type={type === "number" ? "number" : type === "date" ? "date" : "text"}
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

const statusBg: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  confirmed: "bg-blue-100 text-blue-700",
  in_production: "bg-yellow-100 text-yellow-800",
  ready: "bg-green-100 text-green-700",
  shipped: "bg-purple-100 text-purple-700",
  delivered: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

const priorityBg: Record<string, string> = {
  low: "text-gray-500",
  normal: "text-blue-600",
  high: "text-orange-600 font-semibold",
  urgent: "text-red-600 font-bold",
};

const STATUS_OPTIONS = Object.entries(ORDER_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }));
const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS).map(([v, l]) => ({ value: v, label: l }));

export function OrderTable({ orders, showFinance, canEdit, onReload, onNewOrder, onAssignTask }: OrderTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo<ColumnDef<Order>[]>(() => {
    const cols: ColumnDef<Order>[] = [
      {
        accessorKey: "order_no",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-7 text-xs px-1" onClick={() => column.toggleSorting()}>
            Sip. No <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs font-semibold text-blue-700">{row.getValue("order_no")}</span>
        ),
        size: 120,
      },
      {
        accessorKey: "customer",
        header: "Müşteri",
        cell: ({ row }) => canEdit ? (
          <InlineCell value={row.original.customer} field="customer" orderId={row.original.id} onSaved={onReload} />
        ) : row.original.customer,
        size: 140,
      },
      {
        accessorKey: "product_type",
        header: "Ürün",
        cell: ({ row }) => canEdit ? (
          <InlineCell value={row.original.product_type} field="product_type" orderId={row.original.id} onSaved={onReload} />
        ) : row.original.product_type,
        size: 120,
      },
      {
        accessorKey: "micron",
        header: "Mikron",
        cell: ({ row }) => canEdit ? (
          <InlineCell value={row.original.micron} field="micron" orderId={row.original.id} type="number" onSaved={onReload} />
        ) : (row.original.micron ?? "—"),
        size: 70,
      },
      {
        accessorKey: "width",
        header: "En",
        cell: ({ row }) => canEdit ? (
          <InlineCell value={row.original.width} field="width" orderId={row.original.id} type="number" onSaved={onReload} />
        ) : (row.original.width ?? "—"),
        size: 70,
      },
      {
        accessorKey: "quantity",
        header: "Miktar",
        cell: ({ row }) => canEdit ? (
          <InlineCell value={row.original.quantity} field="quantity" orderId={row.original.id} type="number" onSaved={onReload} />
        ) : (row.original.quantity ? `${row.original.quantity}` : "—"),
        size: 80,
      },
      {
        accessorKey: "unit",
        header: "Brm",
        cell: ({ row }) => canEdit ? (
          <InlineCell value={row.original.unit} field="unit" orderId={row.original.id} onSaved={onReload} />
        ) : row.original.unit,
        size: 50,
      },
      {
        accessorKey: "trim_width",
        header: "Kes.Eni",
        cell: ({ row }) => canEdit ? (
          <InlineCell value={row.original.trim_width} field="trim_width" orderId={row.original.id} type="number" onSaved={onReload} />
        ) : (row.original.trim_width ?? "—"),
        size: 70,
      },
      {
        accessorKey: "source_type",
        header: "Kaynak",
        cell: ({ row }) => {
          const st = row.original.source_type;
          return st === "production"
            ? <Badge className="text-[10px] bg-orange-100 text-orange-700 border-orange-300">Üretim</Badge>
            : <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-300">Stok</Badge>;
        },
        size: 70,
      },
      {
        accessorKey: "ready_quantity",
        header: "Hazır",
        cell: ({ row }) => <span className="font-medium text-green-700">{row.original.ready_quantity ?? 0}</span>,
        size: 60,
      },
      {
        accessorKey: "status",
        header: "Durum",
        cell: ({ row }) => {
          const s = row.original.status;
          if (canEdit) return (
            <InlineCell value={s} field="status" orderId={row.original.id} type="select" options={STATUS_OPTIONS} onSaved={onReload} />
          );
          return <Badge className={`text-[10px] ${statusBg[s] || ""}`}>{ORDER_STATUS_LABELS[s]}</Badge>;
        },
        size: 110,
      },
      {
        accessorKey: "priority",
        header: "Önc.",
        cell: ({ row }) => {
          const p = row.original.priority;
          if (canEdit) return (
            <InlineCell value={p} field="priority" orderId={row.original.id} type="select" options={PRIORITY_OPTIONS} onSaved={onReload} />
          );
          return <span className={priorityBg[p]}>{PRIORITY_LABELS[p]}</span>;
        },
        size: 80,
      },
      {
        accessorKey: "ship_date",
        header: "Sevk",
        cell: ({ row }) => canEdit ? (
          <InlineCell value={row.original.ship_date?.split("T")[0] ?? ""} field="ship_date" orderId={row.original.id} type="date" onSaved={onReload} />
        ) : (row.original.ship_date ? new Date(row.original.ship_date).toLocaleDateString("tr-TR") : "—"),
        size: 100,
      },
    ];

    if (showFinance) {
      cols.push(
        {
          accessorKey: "price",
          header: "Fiyat",
          cell: ({ row }) => canEdit ? (
            <InlineCell value={row.original.price} field="price" orderId={row.original.id} type="number" onSaved={onReload} />
          ) : (row.original.price ? `${row.original.price?.toLocaleString("tr-TR")} ${row.original.currency}` : "—"),
          size: 100,
        },
        {
          accessorKey: "payment_term",
          header: "Vade",
          cell: ({ row }) => canEdit ? (
            <InlineCell value={row.original.payment_term} field="payment_term" orderId={row.original.id} onSaved={onReload} />
          ) : (row.original.payment_term ?? "—"),
          size: 80,
        },
      );
    }

    cols.push({
      id: "tasks",
      header: "Görevler",
      cell: ({ row }) => {
        const tasks = row.original.task_summary || [];
        if (tasks.length === 0) return <span className="text-muted-foreground text-[10px]">Atanmadı</span>;
        return (
          <div className="flex flex-wrap gap-0.5">
            {tasks.map((t: TaskSummary, i: number) => {
              const dept = ROLE_LABELS[t.department as keyof typeof ROLE_LABELS] || t.department;
              const st = TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS] || t.status;
              const bg = t.status === "done" ? "bg-green-100 text-green-800"
                : t.status === "in_progress" ? "bg-blue-100 text-blue-800"
                : t.status === "preparing" ? "bg-yellow-100 text-yellow-800"
                : "bg-gray-100 text-gray-700";
              return (
                <span key={i} className={`inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full ${bg}`}>
                  {dept}{t.assignee_name ? ` (${t.assignee_name})` : ""}: {st}
                </span>
              );
            })}
          </div>
        );
      },
      size: 200,
    });

    if (canEdit) {
      cols.push({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={(e) => { e.stopPropagation(); onAssignTask(row.original); }}>
            + Görev
          </Button>
        ),
        size: 70,
      });
    }

    return cols;
  }, [showFinance, canEdit, onReload, onAssignTask]);

  const table = useReactTable({
    data: orders,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Ara... (müşteri, ürün, sipariş no)"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">{table.getFilteredRowModel().rows.length} sipariş</span>
        {canEdit && (
          <Button size="sm" className="h-8" onClick={onNewOrder}>
            <Plus className="h-3 w-3 mr-1" /> Yeni
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-white shadow-sm overflow-auto max-h-[calc(100vh-200px)]">
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
              <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-muted-foreground text-sm">Sipariş yok</td></tr>
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
    </div>
  );
}
