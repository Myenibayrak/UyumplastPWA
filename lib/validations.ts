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
});

export const orderUpdateSchema = orderCreateSchema.partial().extend({
  status: z.enum(["draft", "confirmed", "in_production", "ready", "shipped", "delivered", "cancelled"]).optional(),
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

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;
export type TaskAssignInput = z.infer<typeof taskAssignSchema>;
export type TaskProgressInput = z.infer<typeof taskProgressSchema>;
