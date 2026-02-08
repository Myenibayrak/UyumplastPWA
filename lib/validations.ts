import { z } from "zod";

export const orderCreateSchema = z.object({
  customer: z.string().min(1, "Müşteri zorunlu"),
  product_type: z.string().min(1, "Ürün tipi zorunlu"),
  micron: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  quantity: z.number().nullable().optional(),
  unit: z.string().default("kg"),
  trim_width: z.number().nullable().optional(),
  ready_bobbin: z.number().nullable().optional(),
  price: z.number().nullable().optional(),
  payment_term: z.string().nullable().optional(),
  currency: z.string().default("TRY"),
  ship_date: z.string().nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  notes: z.string().nullable().optional(),
  source_type: z.enum(["stock", "production", "both"]).default("stock"),
});

export const orderUpdateSchema = orderCreateSchema.partial().extend({
  status: z.enum(["draft", "confirmed", "in_production", "ready", "shipped", "delivered", "cancelled", "closed"]).optional(),
  ready_quantity: z.number().nullable().optional(),
});

export const taskAssignSchema = z.object({
  order_id: z.string().uuid(),
  department: z.enum(["warehouse", "production", "shipping"]),
  assigned_to: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  due_date: z.string().nullable().optional(),
});

export const taskProgressSchema = z.object({
  status: z.enum(["pending", "in_progress", "preparing", "ready", "done", "cancelled"]),
  ready_quantity: z.number().nullable().optional(),
  progress_note: z.string().nullable().optional(),
});

export const cuttingPlanCreateSchema = z.object({
  order_id: z.string().uuid(),
  source_stock_id: z.string().uuid().nullable().optional(),
  source_product: z.string().min(1, "Kaynak ürün zorunlu"),
  source_micron: z.number().nullable().optional(),
  source_width: z.number().nullable().optional(),
  source_kg: z.number().nullable().optional(),
  target_width: z.number().nullable().optional(),
  target_kg: z.number().nullable().optional(),
  target_quantity: z.number().int().positive().default(1),
  assigned_to: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const cuttingPlanUpdateSchema = z.object({
  status: z.enum(["planned", "in_progress", "completed", "cancelled"]).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  source_stock_id: z.string().uuid().nullable().optional(),
  source_product: z.string().min(1).optional(),
  source_micron: z.number().nullable().optional(),
  source_width: z.number().nullable().optional(),
  source_kg: z.number().nullable().optional(),
  target_width: z.number().nullable().optional(),
  target_kg: z.number().nullable().optional(),
  target_quantity: z.number().int().positive().optional(),
  notes: z.string().nullable().optional(),
}).refine((val) => Object.keys(val).length > 0, {
  message: "En az bir güncelleme alanı gönderilmeli",
});

export const stockCreateSchema = z.object({
  category: z.enum(["film", "tape"]).default("film"),
  product: z.string().min(1, "Ürün adı zorunlu"),
  micron: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  kg: z.number().default(0),
  quantity: z.number().int().default(0),
  lot_no: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const stockUpdateSchema = stockCreateSchema.partial();

export type StockCreateInput = z.infer<typeof stockCreateSchema>;
export type StockUpdateInput = z.infer<typeof stockUpdateSchema>;

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;
export type TaskAssignInput = z.infer<typeof taskAssignSchema>;
export type TaskProgressInput = z.infer<typeof taskProgressSchema>;
export type CuttingPlanCreateInput = z.infer<typeof cuttingPlanCreateSchema>;
export type CuttingPlanUpdateInput = z.infer<typeof cuttingPlanUpdateSchema>;
