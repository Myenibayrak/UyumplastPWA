"use client";

import { useState, useMemo } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  getPaginationRowModel, flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import type { Order } from "@/lib/types";
import { ORDER_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

interface OrderTableProps {
  orders: Order[];
  showFinance: boolean;
  onSelect?: (order: Order) => void;
}

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = {
  draft: "secondary",
  confirmed: "default",
  in_production: "warning",
  ready: "success",
  shipped: "outline",
  delivered: "success",
  cancelled: "destructive",
};

export function OrderTable({ orders, showFinance, onSelect }: OrderTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo<ColumnDef<Order>[]>(() => {
    const cols: ColumnDef<Order>[] = [
      {
        accessorKey: "order_no",
        header: ({ column }) => (
          <Button variant="ghost" onClick={() => column.toggleSorting()}>
            Sipariş No <ArrowUpDown className="ml-1 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => <span className="font-medium">{row.getValue("order_no")}</span>,
      },
      {
        accessorKey: "customer",
        header: "Müşteri",
      },
      {
        accessorKey: "product_type",
        header: "Ürün Tipi",
      },
      {
        accessorKey: "quantity",
        header: "Miktar",
        cell: ({ row }) => {
          const q = row.original.quantity;
          return q ? `${q} ${row.original.unit}` : "-";
        },
      },
      {
        accessorKey: "status",
        header: "Durum",
        cell: ({ row }) => {
          const s = row.getValue("status") as string;
          return <Badge variant={statusVariant[s] || "secondary"}>{ORDER_STATUS_LABELS[s as keyof typeof ORDER_STATUS_LABELS] || s}</Badge>;
        },
      },
      {
        accessorKey: "priority",
        header: "Öncelik",
        cell: ({ row }) => {
          const p = row.getValue("priority") as string;
          return PRIORITY_LABELS[p as keyof typeof PRIORITY_LABELS] || p;
        },
      },
      {
        accessorKey: "ship_date",
        header: "Sevk Tarihi",
        cell: ({ row }) => {
          const d = row.getValue("ship_date") as string | null;
          return d ? new Date(d).toLocaleDateString("tr-TR") : "-";
        },
      },
    ];

    if (showFinance) {
      cols.push(
        {
          accessorKey: "price",
          header: "Fiyat",
          cell: ({ row }) => {
            const p = row.original.price;
            return p ? `${p.toLocaleString("tr-TR")} ${row.original.currency}` : "-";
          },
        },
        {
          accessorKey: "payment_term",
          header: "Ödeme Vadesi",
        }
      );
    }

    return cols;
  }, [showFinance]);

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
    initialState: { pagination: { pageSize: 20 } },
  });

  return (
    <div className="space-y-4">
      <Input
        placeholder="Ara..."
        value={globalFilter}
        onChange={(e) => setGlobalFilter(e.target.value)}
        className="max-w-sm"
      />
      <div className="rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-4 py-3 text-left font-medium">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                  Sipariş bulunamadı
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => onSelect?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} sipariş
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
          </span>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
