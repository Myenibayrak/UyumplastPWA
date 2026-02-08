"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { OrderTable } from "@/components/orders/order-table";
import { OrderForm } from "@/components/orders/order-form";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { Order, AppRole } from "@/lib/types";
import { canViewFinance, canManageOrders } from "@/lib/rbac";

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [role, setRole] = useState<AppRole | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<Order | null>(null);

  const loadOrders = useCallback(async () => {
    const res = await fetch("/api/orders");
    if (res.ok) {
      const data = await res.json();
      setOrders(data);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (profile) setRole(profile.role as AppRole);
    });
    loadOrders();
  }, [loadOrders]);

  function handleSelect(order: Order) {
    setEditOrder(order);
    setFormOpen(true);
  }

  function handleNew() {
    setEditOrder(null);
    setFormOpen(true);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Siparişler</h1>
        {role && canManageOrders(role) && (
          <Button onClick={handleNew}>
            <Plus className="h-4 w-4 mr-2" />
            Yeni Sipariş
          </Button>
        )}
      </div>
      <OrderTable
        orders={orders}
        showFinance={role ? canViewFinance(role) : false}
        onSelect={handleSelect}
      />
      <OrderForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSuccess={loadOrders}
        editOrder={editOrder}
      />
    </div>
  );
}
