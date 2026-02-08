import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";

const SETUP_SQL = `
-- ============================================================
-- MyPlast OMS — Full Database Setup (Idempotent)
-- ============================================================

-- 1) ENUMS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin','sales','warehouse','production','shipping','accounting');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE public.order_status AS ENUM ('draft','confirmed','in_production','ready','shipped','delivered','cancelled');
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
  price numeric,
  payment_term text,
  currency text NOT NULL DEFAULT 'TRY',
  ship_date timestamptz,
  priority public.priority_level NOT NULL DEFAULT 'normal',
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  assigned_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- order_tasks
CREATE TABLE IF NOT EXISTS public.order_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  department public.app_role NOT NULL,
  assigned_to uuid REFERENCES public.profiles(id),
  status public.task_status NOT NULL DEFAULT 'pending',
  priority public.priority_level NOT NULL DEFAULT 'normal',
  due_date timestamptz,
  ready_quantity numeric,
  progress_note text,
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
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_definitions_category ON public.definitions(category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON public.audit_logs(table_name);

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

-- 6) RLS

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_tasks ENABLE ROW LEVEL SECURITY;
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
    public.has_any_role(ARRAY['admin','sales','accounting']::public.app_role[])
    OR id IN (SELECT order_id FROM public.order_tasks WHERE assigned_to = auth.uid() OR department = (SELECT role FROM public.profiles WHERE id = auth.uid()))
  );
CREATE POLICY oms_orders_insert ON public.orders FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(ARRAY['admin','sales']::public.app_role[]));
CREATE POLICY oms_orders_update ON public.orders FOR UPDATE TO authenticated
  USING (public.has_any_role(ARRAY['admin','sales']::public.app_role[]));
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

-- notifications policies
CREATE POLICY oms_notif_select ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY oms_notif_update ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY oms_notif_insert ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (true);

-- audit_logs policies
CREATE POLICY oms_audit_select ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin']::public.app_role[]));
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

-- 7) GRANTS
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- 8) SEED DATA (idempotent inserts)

-- Default system settings
INSERT INTO public.system_settings (key, value, description) VALUES
  ('order_no_prefix', 'ORD', 'Sipariş numarası ön eki'),
  ('company_name', 'MyPlast', 'Firma adı'),
  ('default_currency', 'TRY', 'Varsayılan para birimi'),
  ('default_unit', 'kg', 'Varsayılan birim'),
  ('app_title', 'MyPlast OMS', 'Uygulama başlığı')
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
  ('order_flow', '{"statuses":["draft","confirmed","in_production","ready","shipped","delivered","cancelled"],"transitions":{"draft":["confirmed","cancelled"],"confirmed":["in_production","cancelled"],"in_production":["ready","cancelled"],"ready":["shipped","cancelled"],"shipped":["delivered"],"delivered":[],"cancelled":[]}}'::jsonb),
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
  ('admin', 'manage_settings', true),
  ('admin', 'view_finance', true),
  ('admin', 'manage_users', true),
  ('sales', 'manage_orders', true),
  ('sales', 'manage_tasks', true),
  ('sales', 'view_finance', true),
  ('accounting', 'view_orders', true),
  ('accounting', 'view_finance', true),
  ('warehouse', 'view_own_tasks', true),
  ('warehouse', 'update_own_tasks', true),
  ('production', 'view_own_tasks', true),
  ('production', 'update_own_tasks', true),
  ('shipping', 'view_own_tasks', true),
  ('shipping', 'update_own_tasks', true)
ON CONFLICT (role, permission) DO NOTHING;

-- Enable realtime for notifications and order_tasks
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
