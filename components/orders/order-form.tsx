"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { orderCreateSchema, type OrderCreateInput } from "@/lib/validations";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Definition, Order } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import { Package, Factory } from "lucide-react";

interface OrderFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  editOrder?: Order | null;
  showFinance?: boolean;
}

export function OrderForm({ open, onOpenChange, onSuccess, editOrder, showFinance = true }: OrderFormProps) {
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [filmTypes, setFilmTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<OrderCreateInput>({
    resolver: zodResolver(orderCreateSchema),
    defaultValues: {
      unit: "kg",
      currency: "TRY",
      priority: "normal",
      source_type: "stock",
    },
  });

  const sourceType = watch("source_type");

  useEffect(() => {
    const supabase = createClient();
    supabase.from("definitions").select("*").eq("active", true).order("sort_order").then(({ data }) => {
      if (data) setDefinitions(data as Definition[]);
    });
    // Get unique product names from stock for the product dropdown
    supabase.from("definitions").select("label").eq("category", "film_type").eq("active", true).order("label").then(({ data }) => {
      if (data) setFilmTypes(data.map((d: { label: string }) => d.label));
    });
  }, []);

  useEffect(() => {
    if (editOrder) {
      reset({
        customer: editOrder.customer,
        product_type: editOrder.product_type,
        micron: editOrder.micron,
        width: editOrder.width,
        quantity: editOrder.quantity,
        unit: editOrder.unit,
        trim_width: editOrder.trim_width,
        ready_bobbin: editOrder.ready_bobbin,
        price: editOrder.price,
        payment_term: editOrder.payment_term,
        currency: editOrder.currency,
        ship_date: editOrder.ship_date ? editOrder.ship_date.split("T")[0] : null,
        priority: editOrder.priority,
        notes: editOrder.notes,
        source_type: editOrder.source_type || "stock",
      });
    } else {
      reset({ unit: "kg", currency: "TRY", priority: "normal", source_type: "stock" });
    }
  }, [editOrder, reset]);

  const getDefsByCategory = (cat: string) => definitions.filter((d) => d.category === cat);

  async function onSubmit(data: OrderCreateInput) {
    setLoading(true);
    try {
      const url = editOrder ? `/api/orders/${editOrder.id}` : "/api/orders";
      const method = editOrder ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.toString() || "Hata oluştu");
      }
      toast({ title: editOrder ? "Sipariş güncellendi" : "Sipariş oluşturuldu" });
      onSuccess();
      onOpenChange(false);
    } catch (err: unknown) {
      toast({ title: "Hata", description: err instanceof Error ? err.message : "Bilinmeyen hata", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editOrder ? "Siparişi Düzenle" : "Yeni Sipariş"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Kaynak Tipi */}
          <div className="space-y-2">
            <Label className="font-semibold">Kaynak *</Label>
            <div className="flex gap-2">
              <Button type="button" variant={sourceType === "stock" ? "default" : "outline"} className="flex-1 h-10"
                onClick={() => setValue("source_type", "stock")}>
                <Package className="h-4 w-4 mr-2" /> Stoktan
              </Button>
              <Button type="button" variant={sourceType === "production" ? "default" : "outline"} className="flex-1 h-10"
                onClick={() => setValue("source_type", "production")}>
                <Factory className="h-4 w-4 mr-2" /> Üretim
              </Button>
            </div>
            {sourceType === "production" && (
              <p className="text-xs text-orange-600 bg-orange-50 p-2 rounded">Üretim seçildi — sipariş oluşturulunca fabrika müdürüne planlama bildirimi gidecek.</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Müşteri *</Label>
              <Select onValueChange={(v) => setValue("customer", v)} value={watch("customer") || ""}>
                <SelectTrigger><SelectValue placeholder="Müşteri seçin" /></SelectTrigger>
                <SelectContent>
                  {getDefsByCategory("customer").map((d) => (
                    <SelectItem key={d.id} value={d.label}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.customer && <p className="text-xs text-destructive">{errors.customer.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>Ürün Cinsi *</Label>
              <Select onValueChange={(v) => setValue("product_type", v)} value={watch("product_type") || ""}>
                <SelectTrigger><SelectValue placeholder="Ürün seçin" /></SelectTrigger>
                <SelectContent>
                  {filmTypes.map((ft) => (
                    <SelectItem key={ft} value={ft}>{ft}</SelectItem>
                  ))}
                  {getDefsByCategory("product_type").map((d) => (
                    <SelectItem key={d.id} value={d.label}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.product_type && <p className="text-xs text-destructive">{errors.product_type.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>Mikron</Label>
              <Input type="number" step="0.01" {...register("micron", { valueAsNumber: true })} />
            </div>

            <div className="space-y-2">
              <Label>En (mm)</Label>
              <Input type="number" step="0.01" {...register("width", { valueAsNumber: true })} />
            </div>

            <div className="space-y-2">
              <Label>Miktar</Label>
              <Input type="number" step="0.01" {...register("quantity", { valueAsNumber: true })} />
            </div>

            <div className="space-y-2">
              <Label>Birim</Label>
              <Select onValueChange={(v) => setValue("unit", v)} value={watch("unit") || "kg"}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">kg</SelectItem>
                  <SelectItem value="adet">Adet</SelectItem>
                  <SelectItem value="metre">Metre</SelectItem>
                  {getDefsByCategory("unit").map((d) => (
                    <SelectItem key={d.id} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Kesim Eni <span className="text-xs text-muted-foreground">(opsiyonel)</span></Label>
              <Input type="number" step="0.01" {...register("trim_width", { valueAsNumber: true })} placeholder="Belirtilmemişse boş bırakın" />
            </div>

            <div className="space-y-2">
              <Label>Sevk Tarihi</Label>
              <Input type="date" {...register("ship_date")} />
            </div>

            {showFinance && (
              <>
                <div className="space-y-2">
                  <Label>Fiyat</Label>
                  <Input type="number" step="0.01" {...register("price", { valueAsNumber: true })} />
                </div>

                <div className="space-y-2">
                  <Label>Ödeme Vadesi</Label>
                  <Select onValueChange={(v) => setValue("payment_term", v)} value={watch("payment_term") || ""}>
                    <SelectTrigger><SelectValue placeholder="Seçin" /></SelectTrigger>
                    <SelectContent>
                      {getDefsByCategory("payment_term").map((d) => (
                        <SelectItem key={d.id} value={d.label}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Para Birimi</Label>
                  <Select onValueChange={(v) => setValue("currency", v)} value={watch("currency") || "TRY"}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TRY">TRY</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      {getDefsByCategory("currency").map((d) => (
                        <SelectItem key={d.id} value={d.value}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label>Öncelik</Label>
              <Select onValueChange={(v) => setValue("priority", v as OrderCreateInput["priority"])} value={watch("priority") || "normal"}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Düşük</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Yüksek</SelectItem>
                  <SelectItem value="urgent">Acil</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notlar</Label>
            <Textarea {...register("notes")} placeholder="Sipariş notları..." />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Kaydediliyor..." : editOrder ? "Güncelle" : "Oluştur"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
