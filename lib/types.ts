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
  | "cancelled"
  | "closed";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Taslak",
  confirmed: "Onaylandı",
  in_production: "Üretimde",
  ready: "Hazır",
  shipped: "Sevk Edildi",
  delivered: "Teslim Edildi",
  cancelled: "İptal",
  closed: "Kapatıldı",
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

export type HandoverStatus = "open" | "resolved";

export const HANDOVER_STATUS_LABELS: Record<HandoverStatus, string> = {
  open: "Açık",
  resolved: "Çözüldü",
};

export interface Profile {
  id: string;
  full_name: string;
  role: AppRole;
  active?: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskSummary {
  department: string;
  status: string;
  assignee_name: string | null;
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
  source_type: "stock" | "production" | "both";
  stock_ready_kg: number;
  production_ready_kg: number;
  closed_by: string | null;
  closed_at: string | null;
  created_by: string;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
  task_summary?: TaskSummary[];
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

export interface DirectMessage {
  id: string;
  sender_id: string;
  recipient_id: string;
  parent_id: string | null;
  message: string;
  read_at: string | null;
  created_at: string;
  updated_at: string;
  sender?: Pick<Profile, "id" | "full_name" | "role"> | null;
  recipient?: Pick<Profile, "id" | "full_name" | "role"> | null;
}

export interface TaskMessage {
  id: string;
  task_id: string;
  sender_id: string;
  parent_id: string | null;
  message: string;
  created_at: string;
  updated_at: string;
  sender?: Pick<Profile, "id" | "full_name" | "role"> | null;
}

export interface HandoverNote {
  id: string;
  department: AppRole;
  shift_date: string;
  title: string;
  details: string;
  priority: Priority;
  status: HandoverStatus;
  created_by: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolved_note: string | null;
  created_at: string;
  updated_at: string;
  creator?: Pick<Profile, "id" | "full_name" | "role"> | null;
  resolver?: Pick<Profile, "id" | "full_name" | "role"> | null;
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
  ip_address: string | null;
  created_at: string;
}

export interface WorkflowSetting {
  id: string;
  name: string;
  config: Record<string, unknown>;
  description: string | null;
  active: boolean;
  updated_at: string;
}

export interface NotificationTemplate {
  id: string;
  event_type: string;
  title_template: string;
  body_template: string;
  active: boolean;
  updated_at: string;
}

export interface UiSetting {
  id: string;
  key: string;
  value: Record<string, unknown>;
  description: string | null;
  updated_at: string;
}

export interface FeatureFlag {
  id: string;
  flag: string;
  enabled: boolean;
  description: string | null;
  updated_at: string;
}

export interface RolePermission {
  id: string;
  role: AppRole;
  permission: string;
  allowed: boolean;
}

export type StockCategory = "film" | "tape";

export const STOCK_CATEGORY_LABELS: Record<StockCategory, string> = {
  film: "Film Stoğu",
  tape: "Bant Stoğu",
};

export interface StockItem {
  id: string;
  category: StockCategory;
  product: string;
  micron: number | null;
  width: number | null;
  kg: number;
  quantity: number;
  lot_no: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type CuttingPlanStatus = "planned" | "in_progress" | "completed" | "cancelled";

export const CUTTING_PLAN_STATUS_LABELS: Record<CuttingPlanStatus, string> = {
  planned: "Planlandı",
  in_progress: "Kesimde",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

export interface CuttingSpec {
  en: number;
  bant?: string;
  cap?: string;
  firma?: string;
  kg?: number;
}

export interface CuttingPlan {
  id: string;
  order_id: string;
  source_stock_id: string | null;
  source_product: string;
  source_micron: number | null;
  source_width: number | null;
  source_kg: number | null;
  target_width: number | null;
  target_kg: number | null;
  target_quantity: number;
  assigned_to: string | null;
  planned_by: string;
  status: CuttingPlanStatus;
  notes: string | null;
  cutting_spec: CuttingSpec[];
  sort_order: number;
  created_at: string;
  updated_at: string;
  order?: Order;
  assignee?: Profile;
  planner?: Profile;
  entries?: CuttingEntry[];
}

export interface CuttingEntry {
  id: string;
  cutting_plan_id: string;
  order_id: string;
  source_stock_id: string | null;
  bobbin_label: string;
  cut_width: number;
  cut_kg: number;
  cut_quantity: number;
  is_order_piece: boolean;
  entered_by: string;
  machine_no: string | null;
  firma: string | null;
  cap: string | null;
  bant: string | null;
  piece_weight: number | null;
  notes: string | null;
  created_at: string;
}

export interface StockMovement {
  id: string;
  stock_item_id: string | null;
  movement_type: "in" | "out";
  kg: number;
  quantity: number;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export type SourceType = "stock" | "production" | "both";

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  stock: "Stok",
  production: "Üretim",
  both: "Stok + Üretim",
};

export const SOURCE_TYPE_ICONS: Record<SourceType, string> = {
  stock: "📦",
  production: "🏭",
  both: "📦+🏭",
};

export type ProductionBobinStatus = "produced" | "warehouse" | "ready";

export const PRODUCTION_BOBIN_STATUS_LABELS: Record<ProductionBobinStatus, string> = {
  produced: "Üretildi",
  warehouse: "Depoda",
  ready: "Hazır",
};

export interface ProductionBobin {
  id: string;
  order_id: string;
  cutting_plan_id: string | null;
  bobbin_no: string;
  meter: number;
  kg: number;
  fire_kg: number;
  product_type: string;
  micron: number | null;
  width: number | null;
  status: ProductionBobinStatus;
  notes: string | null;
  entered_by: string;
  entered_at: string;
  warehouse_in_at: string | null;
  warehouse_in_by: string | null;
  created_at: string;
  updated_at: string;
  order?: Order;
  cutting_plan?: CuttingPlan;
  entered_by_profile?: Profile;
  warehouse_in_by_profile?: Profile;
}

export interface OrderStockEntry {
  id: string;
  order_id: string;
  bobbin_label: string;
  kg: number;
  notes: string | null;
  entered_by: string;
  entered_at: string;
  created_at: string;
  updated_at: string;
  entered_by_profile?: Profile;
}

export type ShippingScheduleStatus = "planned" | "completed" | "cancelled";

export const SHIPPING_SCHEDULE_STATUS_LABELS: Record<ShippingScheduleStatus, string> = {
  planned: "Planlandı",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

export interface ShippingSchedule {
  id: string;
  order_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  sequence_no: number;
  status: ShippingScheduleStatus;
  notes: string | null;
  carry_count: number;
  created_by: string;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  order?: Order;
  creator?: Profile;
  completer?: Profile;
}
