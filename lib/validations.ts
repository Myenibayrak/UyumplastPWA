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
  message: z.string().max(2000, "Görev mesajı çok uzun").nullable().optional(),
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

export const orderNudgeSchema = z.object({
  target_user_id: z.string().uuid("Geçerli hedef kullanıcı seçin"),
  message: z.string().min(3, "Mesaj en az 3 karakter olmalı").max(500, "Mesaj çok uzun"),
});

export const shippingScheduleCreateSchema = z.object({
  order_id: z.string().uuid(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD olmalı"),
  scheduled_time: z.string().regex(/^\d{2}:\d{2}$/, "Saat HH:MM olmalı").nullable().optional(),
  sequence_no: z.number().int().min(1).max(500).default(1),
  notes: z.string().nullable().optional(),
});

export const shippingScheduleUpdateSchema = z.object({
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD olmalı").optional(),
  scheduled_time: z.string().regex(/^\d{2}:\d{2}$/, "Saat HH:MM olmalı").nullable().optional(),
  sequence_no: z.number().int().min(1).max(500).optional(),
  status: z.enum(["planned", "completed", "cancelled"]).optional(),
  notes: z.string().nullable().optional(),
}).refine((val) => Object.keys(val).length > 0, {
  message: "En az bir güncelleme alanı gönderilmeli",
});

export const directMessageCreateSchema = z.object({
  recipient_id: z.string().uuid("Geçerli kullanıcı seçin"),
  message: z.string().min(1, "Mesaj boş olamaz").max(2000, "Mesaj çok uzun"),
  parent_id: z.string().uuid().nullable().optional(),
});

export const taskMessageCreateSchema = z.object({
  message: z.string().min(1, "Mesaj boş olamaz").max(2000, "Mesaj çok uzun"),
  parent_id: z.string().uuid().nullable().optional(),
});

export const handoverNoteCreateSchema = z.object({
  department: z.enum(["admin", "sales", "warehouse", "production", "shipping", "accounting"]),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD olmalı"),
  title: z.string().min(3, "Başlık en az 3 karakter olmalı").max(200, "Başlık çok uzun"),
  details: z.string().min(3, "Detay en az 3 karakter olmalı").max(5000, "Detay çok uzun"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export const handoverNoteUpdateSchema = z.object({
  department: z.enum(["admin", "sales", "warehouse", "production", "shipping", "accounting"]).optional(),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD olmalı").optional(),
  title: z.string().min(3).max(200).optional(),
  details: z.string().min(3).max(5000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  status: z.enum(["open", "resolved"]).optional(),
  resolved_note: z.string().max(2000).nullable().optional(),
}).refine((val) => Object.keys(val).length > 0, {
  message: "En az bir alan gönderilmeli",
});

export type StockCreateInput = z.infer<typeof stockCreateSchema>;
export type StockUpdateInput = z.infer<typeof stockUpdateSchema>;

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;
export type TaskAssignInput = z.infer<typeof taskAssignSchema>;
export type TaskProgressInput = z.infer<typeof taskProgressSchema>;
export type CuttingPlanCreateInput = z.infer<typeof cuttingPlanCreateSchema>;
export type CuttingPlanUpdateInput = z.infer<typeof cuttingPlanUpdateSchema>;
export type OrderNudgeInput = z.infer<typeof orderNudgeSchema>;
export type ShippingScheduleCreateInput = z.infer<typeof shippingScheduleCreateSchema>;
export type ShippingScheduleUpdateInput = z.infer<typeof shippingScheduleUpdateSchema>;
export type DirectMessageCreateInput = z.infer<typeof directMessageCreateSchema>;
export type TaskMessageCreateInput = z.infer<typeof taskMessageCreateSchema>;
export type HandoverNoteCreateInput = z.infer<typeof handoverNoteCreateSchema>;
export type HandoverNoteUpdateInput = z.infer<typeof handoverNoteUpdateSchema>;
