import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";

const SETUP_SQL = `
-- ============================================================
-- Uyumplast OMS — Full Database Setup (Idempotent)
-- ============================================================

-- 1) ENUMS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin','sales','warehouse','production','shipping','accounting');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE public.order_status AS ENUM ('draft','confirmed','in_production','ready','shipped','delivered','cancelled','closed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE public.task_status AS ENUM ('pending','in_progress','preparing','ready','done','cancelled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'priority_level') THEN
    CREATE TYPE public.priority_level AS ENUM ('low','normal','high','urgent');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'source_type') THEN
    CREATE TYPE public.source_type AS ENUM ('stock','production','both');
  END IF;
END $$;

DO $$ BEGIN
  ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'confirmed';
  ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'in_production';
  ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'ready';
  ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'closed';
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.source_type ADD VALUE IF NOT EXISTS 'both';
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

-- 2) FUNCTIONS (before tables that reference them)

-- touch_updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- get_my_role
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.app_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- has_any_role
CREATE OR REPLACE FUNCTION public.has_any_role(allowed_roles public.app_role[])
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = ANY(allowed_roles)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- can_view_finance
CREATE OR REPLACE FUNCTION public.can_view_finance()
RETURNS boolean AS $$
  SELECT public.has_any_role(ARRAY['admin','sales','accounting']::public.app_role[]);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- get_my_tasks (worker-safe, no finance fields)
CREATE OR REPLACE FUNCTION public.get_my_tasks()
RETURNS TABLE (
  id uuid,
  order_id uuid,
  department public.app_role,
  assigned_to uuid,
  status public.task_status,
  priority public.priority_level,
  due_date timestamptz,
  ready_quantity numeric,
  progress_note text,
  created_at timestamptz,
  updated_at timestamptz,
  order_no text,
  customer text,
  product_type text,
  micron numeric,
  width numeric,
  quantity numeric,
  unit text,
  trim_width numeric,
  ready_bobbin numeric,
  ship_date timestamptz,
  order_priority public.priority_level,
  order_notes text
) AS $$
  SELECT
    t.id, t.order_id, t.department, t.assigned_to,
    t.status, t.priority, t.due_date, t.ready_quantity,
    t.progress_note, t.created_at, t.updated_at,
    o.order_no, o.customer, o.product_type,
    o.micron, o.width, o.quantity, o.unit,
    o.trim_width, o.ready_bobbin,
    o.ship_date, o.priority AS order_priority, o.notes AS order_notes
  FROM public.order_tasks t
  JOIN public.orders o ON o.id = t.order_id
  WHERE t.assigned_to = auth.uid()
     OR (t.department = (SELECT role FROM public.profiles WHERE id = auth.uid()))
  ORDER BY
    CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    t.due_date ASC NULLS LAST;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- update_my_task (ownership-checked, limited writable fields)
CREATE OR REPLACE FUNCTION public.update_my_task(
  p_task_id uuid,
  p_status public.task_status,
  p_ready_quantity numeric DEFAULT NULL,
  p_progress_note text DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_task public.order_tasks%ROWTYPE;
BEGIN
  SELECT * INTO v_task FROM public.order_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found';
  END IF;
  IF v_task.assigned_to IS NOT NULL AND v_task.assigned_to != auth.uid() THEN
    IF NOT public.has_any_role(ARRAY['admin','sales']::public.app_role[]) THEN
      RAISE EXCEPTION 'Not authorized to update this task';
    END IF;
  END IF;
  UPDATE public.order_tasks
  SET status = p_status,
      ready_quantity = COALESCE(p_ready_quantity, ready_quantity),
      progress_note = COALESCE(p_progress_note, progress_note),
      updated_at = now()
  WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- notify helper
CREATE OR REPLACE FUNCTION public.notify_task_event()
RETURNS TRIGGER AS $$
DECLARE
  v_target_user uuid;
  v_order_no text;
  v_title text;
  v_body text;
BEGIN
  SELECT order_no INTO v_order_no FROM public.orders WHERE id = NEW.order_id;

  IF TG_OP = 'INSERT' AND NEW.assigned_to IS NOT NULL THEN
    v_target_user := NEW.assigned_to;
    v_title := 'Yeni Görev Atandı';
    v_body := 'Sipariş ' || COALESCE(v_order_no, '') || ' için yeni görev atandı.';
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT created_by INTO v_target_user FROM public.orders WHERE id = NEW.order_id;
    v_title := 'Görev Durumu Güncellendi';
    v_body := 'Sipariş ' || COALESCE(v_order_no, '') || ' görevi: ' || NEW.status::text;
  ELSE
    RETURN NEW;
  END IF;

  IF v_target_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, type, ref_id)
    VALUES (v_target_user, v_title, v_body, 'task', NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- order number generator
CREATE OR REPLACE FUNCTION public.generate_order_no()
RETURNS TRIGGER AS $$
DECLARE
  v_prefix text;
  v_year text;
  v_seq bigint;
BEGIN
  SELECT COALESCE(
    (SELECT value FROM public.system_settings WHERE key = 'order_no_prefix'),
    'ORD'
  ) INTO v_prefix;
  v_year := EXTRACT(YEAR FROM now())::text;
  SELECT COALESCE(MAX(
    CAST(NULLIF(regexp_replace(order_no, '^.*-', ''), '') AS bigint)
  ), 0) + 1
  INTO v_seq
  FROM public.orders
  WHERE order_no LIKE v_prefix || '-' || v_year || '-%';

  NEW.order_no := v_prefix || '-' || v_year || '-' || LPAD(v_seq::text, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- handle_new_user_profile trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'sales'::public.app_role)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3) TABLES

-- profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  role public.app_role NOT NULL DEFAULT 'sales',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- definitions
CREATE TABLE IF NOT EXISTS public.definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  label text NOT NULL,
  value text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- system_settings
CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- role_permissions
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  permission text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  UNIQUE(role, permission)
);

-- field_visibility
CREATE TABLE IF NOT EXISTS public.field_visibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  field_name text NOT NULL,
  roles public.app_role[] NOT NULL DEFAULT '{}',
  visible boolean NOT NULL DEFAULT true
);

-- workflow_settings
CREATE TABLE IF NOT EXISTS public.workflow_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  config jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- notification_templates
CREATE TABLE IF NOT EXISTS public.notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL UNIQUE,
  title_template text NOT NULL DEFAULT '',
  body_template text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true
);

-- ui_settings
CREATE TABLE IF NOT EXISTS public.ui_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- feature_flags
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- orders
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text UNIQUE,
  status public.order_status NOT NULL DEFAULT 'draft',
  customer text NOT NULL DEFAULT '',
  product_type text NOT NULL DEFAULT '',
  micron numeric,
  width numeric,
  quantity numeric,
  unit text NOT NULL DEFAULT 'kg',
  trim_width numeric,
  ready_bobbin numeric,
  ready_quantity numeric,
  source_type public.source_type NOT NULL DEFAULT 'stock',
  stock_ready_kg numeric DEFAULT 0,
  production_ready_kg numeric DEFAULT 0,
  price numeric,
  payment_term text,
  currency text NOT NULL DEFAULT 'TRY',
  ship_date timestamptz,
  priority public.priority_level NOT NULL DEFAULT 'normal',
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  assigned_by uuid REFERENCES public.profiles(id),
  closed_by uuid REFERENCES public.profiles(id),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- order_tasks
CREATE TABLE IF NOT EXISTS public.order_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  department public.app_role NOT NULL,
  assigned_to uuid REFERENCES public.profiles(id),
  assigned_by uuid REFERENCES public.profiles(id),
  status public.task_status NOT NULL DEFAULT 'pending',
  priority public.priority_level NOT NULL DEFAULT 'normal',
  due_date timestamptz,
  ready_quantity numeric,
  progress_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_tasks
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES public.profiles(id);

-- direct_messages (kullanicilar arasi mesajlasma)
CREATE TABLE IF NOT EXISTS public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.direct_messages(id) ON DELETE SET NULL,
  message text NOT NULL DEFAULT '',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);

-- task_messages (gorev altinda mesajlasma)
CREATE TABLE IF NOT EXISTS public.task_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.order_tasks(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.task_messages(id) ON DELETE SET NULL,
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- handover_notes (vardiya devir-teslim notlari)
CREATE TABLE IF NOT EXISTS public.handover_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department public.app_role NOT NULL,
  shift_date date NOT NULL DEFAULT CURRENT_DATE,
  title text NOT NULL DEFAULT '',
  details text NOT NULL DEFAULT '',
  priority public.priority_level NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'open',
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolved_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'info',
  ref_id uuid,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id),
  action text NOT NULL,
  table_name text NOT NULL DEFAULT '',
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- stock_items
CREATE TABLE IF NOT EXISTS public.stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL DEFAULT 'film',
  product text NOT NULL,
  micron numeric,
  width numeric,
  kg numeric NOT NULL DEFAULT 0,
  quantity int NOT NULL DEFAULT 0,
  lot_no text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- cutting_plans
CREATE TABLE IF NOT EXISTS public.cutting_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  source_stock_id uuid REFERENCES public.stock_items(id) ON DELETE SET NULL,
  source_product text NOT NULL,
  source_micron numeric,
  source_width numeric,
  source_kg numeric,
  target_width numeric,
  target_kg numeric,
  target_quantity int DEFAULT 1,
  assigned_to uuid REFERENCES public.profiles(id),
  planned_by uuid REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'planned',
  priority public.priority_level NOT NULL DEFAULT 'normal',
  due_date timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- cutting_entries
CREATE TABLE IF NOT EXISTS public.cutting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cutting_plan_id uuid NOT NULL REFERENCES public.cutting_plans(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  source_stock_id uuid REFERENCES public.stock_items(id) ON DELETE SET NULL,
  bobbin_label text NOT NULL,
  cut_width numeric NOT NULL,
  cut_kg numeric NOT NULL,
  cut_quantity int DEFAULT 1,
  is_order_piece boolean NOT NULL DEFAULT true,
  entered_by uuid REFERENCES public.profiles(id),
  machine_no text,
  firma text,
  cap text,
  bant text,
  piece_weight numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- production_bobins (üretim çıktıları)
CREATE TABLE IF NOT EXISTS public.production_bobins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  cutting_plan_id uuid REFERENCES public.cutting_plans(id) ON DELETE SET NULL,
  bobbin_no text NOT NULL,
  meter numeric NOT NULL,
  kg numeric NOT NULL,
  fire_kg numeric DEFAULT 0,
  product_type text NOT NULL,
  micron numeric,
  width numeric,
  status text DEFAULT 'produced',
  notes text,
  entered_by uuid REFERENCES public.profiles(id),
  entered_at timestamptz NOT NULL DEFAULT now(),
  warehouse_in_at timestamptz,
  warehouse_in_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- order_stock_entries (sipariş stok girişleri - depo kg girişi)
CREATE TABLE IF NOT EXISTS public.order_stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  bobbin_label text NOT NULL,
  kg numeric NOT NULL,
  notes text,
  entered_by uuid REFERENCES public.profiles(id),
  entered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- shipping_schedules (gunluk sevkiyat plani)
CREATE TABLE IF NOT EXISTS public.shipping_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  scheduled_time time,
  sequence_no int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'planned',
  notes text,
  carry_count int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id),
  completed_by uuid REFERENCES public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- stock_movements (stok hareketleri)
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id uuid REFERENCES public.stock_items(id) ON DELETE SET NULL,
  movement_type text NOT NULL,
  kg numeric NOT NULL,
  quantity numeric DEFAULT 0,
  reason text NOT NULL,
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4) INDEXES
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders(customer);
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON public.orders(created_by);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_tasks_order_id ON public.order_tasks(order_id);
CREATE INDEX IF NOT EXISTS idx_order_tasks_assigned_to ON public.order_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_order_tasks_department ON public.order_tasks(department);
CREATE INDEX IF NOT EXISTS idx_order_tasks_status ON public.order_tasks(status);
CREATE INDEX IF NOT EXISTS idx_direct_messages_sender ON public.direct_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient ON public.direct_messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation ON public.direct_messages(sender_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_created_at ON public.direct_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_messages_task_id ON public.task_messages(task_id);
CREATE INDEX IF NOT EXISTS idx_task_messages_sender_id ON public.task_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_task_messages_parent_id ON public.task_messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_handover_department ON public.handover_notes(department);
CREATE INDEX IF NOT EXISTS idx_handover_shift_date ON public.handover_notes(shift_date DESC);
CREATE INDEX IF NOT EXISTS idx_handover_status ON public.handover_notes(status);
CREATE INDEX IF NOT EXISTS idx_handover_created_by ON public.handover_notes(created_by);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_definitions_category ON public.definitions(category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON public.audit_logs(table_name);

-- New indexes
CREATE INDEX IF NOT EXISTS idx_stock_items_category ON public.stock_items(category);
CREATE INDEX IF NOT EXISTS idx_stock_items_product ON public.stock_items(product);
CREATE INDEX IF NOT EXISTS idx_cutting_plans_order_id ON public.cutting_plans(order_id);
CREATE INDEX IF NOT EXISTS idx_cutting_plans_assigned_to ON public.cutting_plans(assigned_to);
CREATE INDEX IF NOT EXISTS idx_cutting_plans_status ON public.cutting_plans(status);
CREATE INDEX IF NOT EXISTS idx_cutting_entries_plan_id ON public.cutting_entries(cutting_plan_id);
CREATE INDEX IF NOT EXISTS idx_cutting_entries_order_id ON public.cutting_entries(order_id);
CREATE INDEX IF NOT EXISTS idx_production_bobins_order_id ON public.production_bobins(order_id);
CREATE INDEX IF NOT EXISTS idx_production_bobins_plan_id ON public.production_bobins(cutting_plan_id);
CREATE INDEX IF NOT EXISTS idx_production_bobins_status ON public.production_bobins(status);
CREATE INDEX IF NOT EXISTS idx_order_stock_entries_order_id ON public.order_stock_entries(order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_schedules_date ON public.shipping_schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_shipping_schedules_order_id ON public.shipping_schedules(order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_schedules_status ON public.shipping_schedules(status);
CREATE INDEX IF NOT EXISTS idx_stock_movements_stock_item_id ON public.stock_movements(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON public.stock_movements(reference_type, reference_id);

-- 5) TRIGGERS (drop-if-exists + create for idempotency)

-- updated_at triggers
DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_orders_updated ON public.orders;
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_order_tasks_updated ON public.order_tasks;
CREATE TRIGGER trg_order_tasks_updated BEFORE UPDATE ON public.order_tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_direct_messages_updated ON public.direct_messages;
CREATE TRIGGER trg_direct_messages_updated BEFORE UPDATE ON public.direct_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_task_messages_updated ON public.task_messages;
CREATE TRIGGER trg_task_messages_updated BEFORE UPDATE ON public.task_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_handover_notes_updated ON public.handover_notes;
CREATE TRIGGER trg_handover_notes_updated BEFORE UPDATE ON public.handover_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- order number generator
DROP TRIGGER IF EXISTS trg_order_no ON public.orders;
CREATE TRIGGER trg_order_no BEFORE INSERT ON public.orders
  FOR EACH ROW WHEN (NEW.order_no IS NULL)
  EXECUTE FUNCTION public.generate_order_no();

-- new user profile
DROP TRIGGER IF EXISTS trg_new_user_profile ON auth.users;
CREATE TRIGGER trg_new_user_profile AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

-- task event notifications
DROP TRIGGER IF EXISTS trg_task_notify_insert ON public.order_tasks;
CREATE TRIGGER trg_task_notify_insert AFTER INSERT ON public.order_tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_event();

DROP TRIGGER IF EXISTS trg_task_notify_update ON public.order_tasks;
CREATE TRIGGER trg_task_notify_update AFTER UPDATE ON public.order_tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_event();

-- Production bobin ready update function
CREATE OR REPLACE FUNCTION public.update_order_production_ready()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_order_id := OLD.order_id;
  ELSE
    v_order_id := NEW.order_id;
  END IF;

  UPDATE public.orders
  SET production_ready_kg = (
    SELECT COALESCE(SUM(kg), 0)
    FROM public.production_bobins
    WHERE order_id = v_order_id AND status IN ('produced', 'warehouse', 'ready')
  )
  WHERE id = v_order_id;

  -- If order_id changed on update, recalculate previous order too.
  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    UPDATE public.orders
    SET production_ready_kg = (
      SELECT COALESCE(SUM(kg), 0)
      FROM public.production_bobins
      WHERE order_id = OLD.order_id AND status IN ('produced', 'warehouse', 'ready')
    )
    WHERE id = OLD.order_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Order stock entry ready update function
CREATE OR REPLACE FUNCTION public.update_order_stock_ready()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_order_id := OLD.order_id;
  ELSE
    v_order_id := NEW.order_id;
  END IF;

  UPDATE public.orders
  SET stock_ready_kg = (
    SELECT COALESCE(SUM(kg), 0)
    FROM public.order_stock_entries
    WHERE order_id = v_order_id
  )
  WHERE id = v_order_id;

  IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    UPDATE public.orders
    SET stock_ready_kg = (
      SELECT COALESCE(SUM(kg), 0)
      FROM public.order_stock_entries
      WHERE order_id = OLD.order_id
    )
    WHERE id = OLD.order_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- New triggers for updated_at
DROP TRIGGER IF EXISTS trg_stock_items_updated ON public.stock_items;
CREATE TRIGGER trg_stock_items_updated BEFORE UPDATE ON public.stock_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_cutting_plans_updated ON public.cutting_plans;
CREATE TRIGGER trg_cutting_plans_updated BEFORE UPDATE ON public.cutting_plans
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_cutting_entries_updated ON public.cutting_entries;
CREATE TRIGGER trg_cutting_entries_updated BEFORE UPDATE ON public.cutting_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_production_bobins_updated ON public.production_bobins;
CREATE TRIGGER trg_production_bobins_updated BEFORE UPDATE ON public.production_bobins
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_order_stock_entries_updated ON public.order_stock_entries;
CREATE TRIGGER trg_order_stock_entries_updated BEFORE UPDATE ON public.order_stock_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_shipping_schedules_updated ON public.shipping_schedules;
CREATE TRIGGER trg_shipping_schedules_updated BEFORE UPDATE ON public.shipping_schedules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Production bobin ready trigger
DROP TRIGGER IF EXISTS trg_production_bobin_ready ON public.production_bobins;
CREATE TRIGGER trg_production_bobin_ready AFTER INSERT OR UPDATE OR DELETE ON public.production_bobins
  FOR EACH ROW EXECUTE FUNCTION public.update_order_production_ready();

-- Order stock entry ready trigger
DROP TRIGGER IF EXISTS trg_order_stock_entry_ready ON public.order_stock_entries;
CREATE TRIGGER trg_order_stock_entry_ready AFTER INSERT OR UPDATE OR DELETE ON public.order_stock_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_order_stock_ready();

-- 6) RLS

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handover_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ui_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cutting_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cutting_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_bobins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_stock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for idempotency
DO $$ DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND policyname LIKE 'oms_%'
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- profiles policies
CREATE POLICY oms_profiles_select ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_any_role(ARRAY['admin']::public.app_role[]));

-- orders policies
CREATE POLICY oms_orders_select ON public.orders FOR SELECT TO authenticated
  USING (
    public.has_any_role(ARRAY['admin','sales','accounting','warehouse','shipping','production']::public.app_role[])
    OR id IN (SELECT order_id FROM public.order_tasks WHERE assigned_to = auth.uid() OR department = (SELECT role FROM public.profiles WHERE id = auth.uid()))
  );
CREATE POLICY oms_orders_insert ON public.orders FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(ARRAY['admin','sales']::public.app_role[]));
CREATE POLICY oms_orders_update ON public.orders FOR UPDATE TO authenticated
  USING (public.has_any_role(ARRAY['admin','sales','accounting']::public.app_role[]));
CREATE POLICY oms_orders_delete ON public.orders FOR DELETE TO authenticated
  USING (public.has_any_role(ARRAY['admin']::public.app_role[]));

-- order_tasks policies
CREATE POLICY oms_tasks_select ON public.order_tasks FOR SELECT TO authenticated
  USING (
    public.has_any_role(ARRAY['admin','sales','accounting']::public.app_role[])
    OR assigned_to = auth.uid()
    OR department = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY oms_tasks_insert ON public.order_tasks FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(ARRAY['admin','sales']::public.app_role[]));
CREATE POLICY oms_tasks_update ON public.order_tasks FOR UPDATE TO authenticated
  USING (
    public.has_any_role(ARRAY['admin','sales']::public.app_role[])
    OR assigned_to = auth.uid()
    OR department = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

-- direct_messages policies
CREATE POLICY oms_direct_messages_select ON public.direct_messages FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());
CREATE POLICY oms_direct_messages_insert ON public.direct_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND recipient_id <> auth.uid()
  );
CREATE POLICY oms_direct_messages_update ON public.direct_messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());
CREATE POLICY oms_direct_messages_delete ON public.direct_messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

-- task_messages policies
CREATE POLICY oms_task_messages_select ON public.task_messages FOR SELECT TO authenticated
  USING (
    public.has_any_role(ARRAY['admin','sales','accounting']::public.app_role[])
    OR sender_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.order_tasks t
      JOIN public.orders o ON o.id = t.order_id
      WHERE t.id = task_id
        AND (
          t.assigned_to = auth.uid()
          OR t.assigned_by = auth.uid()
          OR t.department = (SELECT role FROM public.profiles WHERE id = auth.uid())
          OR o.created_by = auth.uid()
        )
    )
  );
CREATE POLICY oms_task_messages_insert ON public.task_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      public.has_any_role(ARRAY['admin','sales','accounting']::public.app_role[])
      OR EXISTS (
        SELECT 1
        FROM public.order_tasks t
        JOIN public.orders o ON o.id = t.order_id
        WHERE t.id = task_id
          AND (
            t.assigned_to = auth.uid()
            OR t.assigned_by = auth.uid()
            OR t.department = (SELECT role FROM public.profiles WHERE id = auth.uid())
            OR o.created_by = auth.uid()
          )
      )
    )
  );
CREATE POLICY oms_task_messages_update ON public.task_messages FOR UPDATE TO authenticated
  USING (
    sender_id = auth.uid()
    OR public.has_any_role(ARRAY['admin','sales','accounting']::public.app_role[])
  );
CREATE POLICY oms_task_messages_delete ON public.task_messages FOR DELETE TO authenticated
  USING (
    sender_id = auth.uid()
    OR public.has_any_role(ARRAY['admin','sales','accounting']::public.app_role[])
  );

-- handover_notes policies
CREATE POLICY oms_handover_select ON public.handover_notes FOR SELECT TO authenticated
  USING (
    public.has_any_role(ARRAY['admin','sales','accounting']::public.app_role[])
    OR department = (SELECT role FROM public.profiles WHERE id = auth.uid())
    OR created_by = auth.uid()
    OR resolved_by = auth.uid()
  );
CREATE POLICY oms_handover_insert ON public.handover_notes FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.has_any_role(ARRAY['admin','sales','accounting']::public.app_role[])
      OR department = (SELECT role FROM public.profiles WHERE id = auth.uid())
    )
  );
CREATE POLICY oms_handover_update ON public.handover_notes FOR UPDATE TO authenticated
  USING (
    public.has_any_role(ARRAY['admin','sales','accounting']::public.app_role[])
    OR created_by = auth.uid()
  );
CREATE POLICY oms_handover_delete ON public.handover_notes FOR DELETE TO authenticated
  USING (public.has_any_role(ARRAY['admin']::public.app_role[]));

-- notifications policies
CREATE POLICY oms_notif_select ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY oms_notif_update ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY oms_notif_insert ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (true);

-- audit_logs policies
CREATE POLICY oms_audit_select ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin','sales','accounting']::public.app_role[]));
CREATE POLICY oms_audit_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (true);

-- definitions policies
CREATE POLICY oms_definitions_select ON public.definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_definitions_manage ON public.definitions FOR ALL TO authenticated
  USING (public.has_any_role(ARRAY['admin']::public.app_role[]));

-- settings tables: read for authenticated, write for admin
CREATE POLICY oms_sys_settings_select ON public.system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_sys_settings_manage ON public.system_settings FOR ALL TO authenticated
  USING (public.has_any_role(ARRAY['admin']::public.app_role[]));

CREATE POLICY oms_role_perms_select ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_role_perms_manage ON public.role_permissions FOR ALL TO authenticated
  USING (public.has_any_role(ARRAY['admin']::public.app_role[]));

CREATE POLICY oms_field_vis_select ON public.field_visibility FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_field_vis_manage ON public.field_visibility FOR ALL TO authenticated
  USING (public.has_any_role(ARRAY['admin']::public.app_role[]));

CREATE POLICY oms_workflow_select ON public.workflow_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_workflow_manage ON public.workflow_settings FOR ALL TO authenticated
  USING (public.has_any_role(ARRAY['admin']::public.app_role[]));

CREATE POLICY oms_notif_tpl_select ON public.notification_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_notif_tpl_manage ON public.notification_templates FOR ALL TO authenticated
  USING (public.has_any_role(ARRAY['admin']::public.app_role[]));

CREATE POLICY oms_ui_settings_select ON public.ui_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_ui_settings_manage ON public.ui_settings FOR ALL TO authenticated
  USING (public.has_any_role(ARRAY['admin']::public.app_role[]));

CREATE POLICY oms_feature_flags_select ON public.feature_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_feature_flags_manage ON public.feature_flags FOR ALL TO authenticated
  USING (public.has_any_role(ARRAY['admin']::public.app_role[]));

-- stock_items policies
CREATE POLICY oms_stock_items_select ON public.stock_items FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_stock_items_insert ON public.stock_items FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(ARRAY['admin','warehouse','accounting']::public.app_role[]));
CREATE POLICY oms_stock_items_update ON public.stock_items FOR UPDATE TO authenticated
  USING (public.has_any_role(ARRAY['admin','warehouse']::public.app_role[]));
CREATE POLICY oms_stock_items_delete ON public.stock_items FOR DELETE TO authenticated
  USING (public.has_any_role(ARRAY['admin']::public.app_role[]));

-- cutting_plans policies
CREATE POLICY oms_cutting_plans_select ON public.cutting_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_cutting_plans_insert ON public.cutting_plans FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(ARRAY['admin','production']::public.app_role[]));
CREATE POLICY oms_cutting_plans_update ON public.cutting_plans FOR UPDATE TO authenticated
  USING (public.has_any_role(ARRAY['admin','production']::public.app_role[]));
CREATE POLICY oms_cutting_plans_delete ON public.cutting_plans FOR DELETE TO authenticated
  USING (public.has_any_role(ARRAY['admin','production']::public.app_role[]));

-- cutting_entries policies
CREATE POLICY oms_cutting_entries_select ON public.cutting_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_cutting_entries_insert ON public.cutting_entries FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(ARRAY['admin','production']::public.app_role[]));
CREATE POLICY oms_cutting_entries_update ON public.cutting_entries FOR UPDATE TO authenticated
  USING (public.has_any_role(ARRAY['admin','production']::public.app_role[]));

-- production_bobins policies
CREATE POLICY oms_production_bobins_select ON public.production_bobins FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_production_bobins_insert ON public.production_bobins FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(ARRAY['admin','production']::public.app_role[]));
CREATE POLICY oms_production_bobins_update ON public.production_bobins FOR UPDATE TO authenticated
  USING (public.has_any_role(ARRAY['admin','production','warehouse']::public.app_role[]));

-- order_stock_entries policies
CREATE POLICY oms_order_stock_entries_select ON public.order_stock_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_order_stock_entries_insert ON public.order_stock_entries FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(ARRAY['admin','warehouse']::public.app_role[]));
CREATE POLICY oms_order_stock_entries_delete ON public.order_stock_entries FOR DELETE TO authenticated
  USING (public.has_any_role(ARRAY['admin','warehouse']::public.app_role[]));

-- shipping_schedules policies
CREATE POLICY oms_shipping_schedules_select ON public.shipping_schedules FOR SELECT TO authenticated
  USING (
    public.has_any_role(ARRAY['admin','sales','shipping','production']::public.app_role[])
    OR created_by = auth.uid()
    OR completed_by = auth.uid()
  );
CREATE POLICY oms_shipping_schedules_insert ON public.shipping_schedules FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(ARRAY['admin','sales','production']::public.app_role[]));
CREATE POLICY oms_shipping_schedules_update ON public.shipping_schedules FOR UPDATE TO authenticated
  USING (public.has_any_role(ARRAY['admin','sales','shipping','production']::public.app_role[]));
CREATE POLICY oms_shipping_schedules_delete ON public.shipping_schedules FOR DELETE TO authenticated
  USING (public.has_any_role(ARRAY['admin','sales','production']::public.app_role[]));

-- stock_movements policies
CREATE POLICY oms_stock_movements_select ON public.stock_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY oms_stock_movements_insert ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (true);

-- 7) GRANTS
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- 8) SEED DATA (idempotent inserts)

-- Default system settings
INSERT INTO public.system_settings (key, value, description) VALUES
  ('order_no_prefix', 'ORD', 'Sipariş numarası ön eki'),
  ('company_name', 'Uyumplast', 'Firma adı'),
  ('default_currency', 'TRY', 'Varsayılan para birimi'),
  ('default_unit', 'kg', 'Varsayılan birim'),
  ('app_title', 'Uyumplast OMS', 'Uygulama başlığı')
ON CONFLICT (key) DO NOTHING;

-- Default definitions
INSERT INTO public.definitions (category, label, value, sort_order) VALUES
  ('customer', 'Müşteri A', 'musteri_a', 1),
  ('customer', 'Müşteri B', 'musteri_b', 2),
  ('customer', 'Müşteri C', 'musteri_c', 3),
  ('product_type', 'Streç Film', 'strec_film', 1),
  ('product_type', 'Shrink Film', 'shrink_film', 2),
  ('product_type', 'PE Film', 'pe_film', 3),
  ('product_type', 'BOPP Film', 'bopp_film', 4),
  ('unit', 'kg', 'kg', 1),
  ('unit', 'metre', 'metre', 2),
  ('unit', 'adet', 'adet', 3),
  ('unit', 'rulo', 'rulo', 4),
  ('payment_term', 'Peşin', 'pesin', 1),
  ('payment_term', '30 Gün', '30_gun', 2),
  ('payment_term', '60 Gün', '60_gun', 3),
  ('payment_term', '90 Gün', '90_gun', 4),
  ('currency', 'TRY', 'TRY', 1),
  ('currency', 'USD', 'USD', 2),
  ('currency', 'EUR', 'EUR', 3)
ON CONFLICT DO NOTHING;

-- Default field visibility (hide finance from workers)
INSERT INTO public.field_visibility (table_name, field_name, roles, visible) VALUES
  ('orders', 'price', ARRAY['admin','sales','accounting']::public.app_role[], true),
  ('orders', 'payment_term', ARRAY['admin','sales','accounting']::public.app_role[], true),
  ('orders', 'currency', ARRAY['admin','sales','accounting']::public.app_role[], true)
ON CONFLICT DO NOTHING;

-- Default workflow settings
INSERT INTO public.workflow_settings (name, config) VALUES
  ('order_flow', '{"statuses":["draft","confirmed","in_production","ready","shipped","delivered","cancelled","closed"],"transitions":{"draft":["confirmed","cancelled"],"confirmed":["in_production","cancelled"],"in_production":["ready","cancelled"],"ready":["shipped","cancelled","closed"],"shipped":["delivered","closed"],"delivered":["closed"],"cancelled":[],"closed":[]}}'::jsonb),
  ('task_flow', '{"statuses":["pending","in_progress","preparing","ready","done","cancelled"],"transitions":{"pending":["in_progress","cancelled"],"in_progress":["preparing","ready","done","cancelled"],"preparing":["ready","done","cancelled"],"ready":["done","cancelled"],"done":[],"cancelled":[]}}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- Default notification templates
INSERT INTO public.notification_templates (event_type, title_template, body_template) VALUES
  ('task_assigned', 'Yeni Görev Atandı', 'Sipariş {{order_no}} için yeni görev atandı.'),
  ('task_status_changed', 'Görev Durumu Değişti', 'Sipariş {{order_no}} görevi: {{status}}'),
  ('order_created', 'Yeni Sipariş', 'Yeni sipariş oluşturuldu: {{order_no}}')
ON CONFLICT (event_type) DO NOTHING;

-- Default feature flags
INSERT INTO public.feature_flags (flag, enabled, description) VALUES
  ('realtime_notifications', true, 'Gerçek zamanlı bildirimler'),
  ('mobile_task_view', true, 'Mobil görev görünümü'),
  ('audit_logging', true, 'Denetim günlüğü'),
  ('dark_mode', false, 'Karanlık mod')
ON CONFLICT (flag) DO NOTHING;

-- Default role permissions
INSERT INTO public.role_permissions (role, permission, allowed) VALUES
  ('admin', 'manage_orders', true),
  ('admin', 'manage_tasks', true),
  ('admin', 'manage_shipping_schedule', true),
  ('admin', 'manage_settings', true),
  ('admin', 'view_finance', true),
  ('admin', 'manage_users', true),
  ('sales', 'manage_orders', true),
  ('sales', 'manage_tasks', true),
  ('sales', 'manage_shipping_schedule', true),
  ('sales', 'view_finance', true),
  ('accounting', 'view_orders', true),
  ('accounting', 'view_finance', true),
  ('warehouse', 'view_own_tasks', true),
  ('warehouse', 'update_own_tasks', true),
  ('production', 'view_own_tasks', true),
  ('production', 'update_own_tasks', true),
  ('production', 'manage_shipping_schedule', true),
  ('shipping', 'view_own_tasks', true),
  ('shipping', 'update_own_tasks', true),
  ('shipping', 'complete_shipping_schedule', true)
ON CONFLICT (role, permission) DO NOTHING;

-- Enable realtime for notifications, tasks and message streams
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'order_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_tasks;
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'direct_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'task_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_messages;
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'handover_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.handover_notes;
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;
`;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const force = url.searchParams.get("force") === "1";
  const adminEmail = url.searchParams.get("adminEmail");

  const expectedToken = process.env.SETUP_TOKEN;
  if (!expectedToken || token !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUrl = process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL;
  if (!dbUrl) {
    return NextResponse.json(
      { error: "SUPABASE_DB_URL or POSTGRES_URL not configured" },
      { status: 500 }
    );
  }

  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();

    if (force) {
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      await client.query("GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;");
    }

    await client.query(SETUP_SQL);

    let adminResult = null;
    if (adminEmail) {
      const res = await client.query(
        `UPDATE public.profiles SET role = 'admin'
         WHERE id = (SELECT id FROM auth.users WHERE email = $1)
         RETURNING id, full_name, role`,
        [adminEmail]
      );
      adminResult = res.rows[0] || null;
      if (!adminResult) {
        adminResult = { message: `User with email ${adminEmail} not found. Register first, then re-run with adminEmail.` };
      }
    }

    const tables = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );

    return NextResponse.json({
      success: true,
      message: force ? "Database reset and re-initialized" : "Database initialized (idempotent)",
      tables: tables.rows.map((r: { tablename: string }) => r.tablename),
      adminResult,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await client.end();
  }
}
