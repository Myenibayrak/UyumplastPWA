export type AppRole = "admin" | "sales" | "warehouse" | "production" | "shipping" | "accounting";

export const APP_ROLES: AppRole[] = ["admin", "sales", "warehouse", "production", "shipping", "accounting"];

export const WORKER_ROLES: AppRole[] = ["warehouse", "production", "shipping"];

export const FINANCE_ROLES: AppRole[] = ["admin", "sales", "accounting"];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Yönetici",
  sales: "Satış",
  warehouse: "Depo",
  production: "Üretim",
  shipping: "Sevkiyat",
  accounting: "Muhasebe",
};

export type OrderStatus =
  | "draft"
  | "confirmed"
  | "in_production"
  | "ready"
  | "shipped"
  | "delivered"
  | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Taslak",
  confirmed: "Onaylandı",
  in_production: "Üretimde",
  ready: "Hazır",
  shipped: "Sevk Edildi",
  delivered: "Teslim Edildi",
  cancelled: "İptal",
};

export type TaskStatus = "pending" | "in_progress" | "preparing" | "ready" | "done" | "cancelled";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Bekliyor",
  in_progress: "Başladı",
  preparing: "Hazırlanıyor",
  ready: "Hazır",
  done: "Bitti",
  cancelled: "İptal",
};

export type Priority = "low" | "normal" | "high" | "urgent";

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

export interface Profile {
  id: string;
  full_name: string;
  role: AppRole;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  order_no: string;
  status: OrderStatus;
  customer: string;
  product_type: string;
  micron: number | null;
  width: number | null;
  quantity: number | null;
  unit: string;
  trim_width: number | null;
  ready_bobbin: number | null;
  ready_quantity: number | null;
  price: number | null;
  payment_term: string | null;
  currency: string;
  ship_date: string | null;
  priority: Priority;
  notes: string | null;
  created_by: string;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderTask {
  id: string;
  order_id: string;
  department: AppRole;
  assigned_to: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  ready_quantity: number | null;
  progress_note: string | null;
  created_at: string;
  updated_at: string;
  order?: Order;
  assignee?: Profile;
}

export interface WorkerTask {
  id: string;
  order_id: string;
  department: AppRole;
  assigned_to: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  ready_quantity: number | null;
  progress_note: string | null;
  created_at: string;
  updated_at: string;
  order_no: string;
  customer: string;
  product_type: string;
  micron: number | null;
  width: number | null;
  quantity: number | null;
  unit: string;
  trim_width: number | null;
  ready_bobbin: number | null;
  ship_date: string | null;
  order_priority: Priority;
  order_notes: string | null;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: string;
  ref_id: string | null;
  read: boolean;
  created_at: string;
}

export interface Definition {
  id: string;
  category: string;
  label: string;
  value: string;
  sort_order: number;
  active: boolean;
}

export interface SystemSetting {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

export interface FieldVisibility {
  id: string;
  table_name: string;
  field_name: string;
  roles: AppRole[];
  visible: boolean;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}
