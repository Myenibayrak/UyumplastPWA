# Uyum Plastik Sipariş Yönetim Sistemi - Hafıza Kayıtları

## Proje Genel Bilgiler
- **Proje Adı**: Uyum Plastik Sipariş Yönetim Sistemi
- **Teknoloji**: Next.js, Supabase, TypeScript, TailwindCSS, shadcn/ui
- **Veritabanı**: PostgreSQL (Supabase)
- **Auth**: Supabase Auth
- **Deployment**: Vercel

## Kullanıcı Rolleri ve Yetkileri
- **admin**: Tüm yetkiler
- **sales**: Sipariş yönetimi, görev atama
- **accounting**: Sipariş kapatma (Evrak Kes)
- **production**: Üretim planlama, görev yönetimi
- **warehouse**: Depo yönetimi
- **shipping**: Sevkiyat yönetimi

## Veritabanı Şeması

### orders Tablosu
```sql
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text NOT NULL,
  customer text NOT NULL,
  product_type text NOT NULL,
  micron integer,
  width integer,
  quantity numeric(10,2) NOT NULL,
  unit text DEFAULT 'kg',
  trim_width integer,
  ship_date timestamptz,
  priority public.priority_level NOT NULL DEFAULT 'normal',
  notes text,
  status public.order_status NOT NULL DEFAULT 'draft',
  source_type public.source_type NOT NULL DEFAULT 'stock',
  stock_ready_kg numeric(10,2) DEFAULT 0,
  production_ready_kg numeric(10,2) DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id),
  closed_by uuid REFERENCES public.profiles(id),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### order_tasks Tablosu
```sql
CREATE TABLE public.order_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  department public.app_role NOT NULL,
  assigned_to uuid REFERENCES public.profiles(id),
  assigned_by uuid REFERENCES public.profiles(id),
  status public.task_status NOT NULL DEFAULT 'pending',
  priority public.priority_level NOT NULL DEFAULT 'normal',
  due_date timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### Enum Tipleri
- **order_status**: draft, pending, in_progress, shipped, delivered, cancelled, closed
- **source_type**: stock, production, both
- **priority_level**: low, normal, high, urgent
- **task_status**: pending, in_progress, preparing, done, cancelled
- **app_role**: admin, sales, accounting, production, warehouse, shipping

## Önemli Fonksiyonlar ve API'ler

### Sipariş Hazırlık Durumu Hesaplama
```typescript
const calculateReadyStatus = (order: Order) => {
  const totalReady = (order.stock_ready_kg || 0) + (order.production_ready_kg || 0);
  const readyPercent = (totalReady / order.quantity) * 100;
  return {
    totalReady,
    readyPercent,
    isReady: readyPercent >= 95
  };
};
```

### FK Disambiguation Pattern
```typescript
// order_tasks tablosunda iki FK profiles'a gittiği için
assignee:profiles!order_tasks_assigned_to_fkey(full_name)
```

### RLS Politikaları
- **orders_select**: `true` (tüm authenticated kullanıcılar görebilir)
- **orders_update**: admin veya sales
- **orders_delete**: sadece admin
- **order_tasks_select**: authenticated kullanıcılar
- **order_tasks_update**: admin veya ilgili departman

## UI Bileşenleri

### OrderTable Özellikleri
- Aktif/Geçmiş tab filtreleme
- Hazır durumu görsel progress bar
- Depo/İmalat kg ayrımı
- Evrak Kes butonu (accounting/admin)
- Görev atama butonu
- Inline editing

### OrderForm Özellikleri
- Kaynak tipi seçimi (stock/production/both)
- Ürün tipi dropdown (definitions tablosundan)
- Mikron, en, kesim genişliği
- Öncelik ve teslim tarihi
- Notlar alanı

## Bildirim Sistemi
- Yeni sipariş oluşturulduğunda:
  - source_type = "production" → üretim ve admin
  - source_type = "both" → üretim ve admin
- Görev atandığında ilgili kullanıcı
- Sipariş durumu değiştiğinde ilgili departmanlar

## Kritik Bilgiler ve Çözümler

### 1. Auth NULL String Sorunu
**Problem**: GoTrue auth.users tablosunda NULL string alanlar scan hatası veriyordu
**Çözüm**: email_change, confirmation_token gibi alanları boş string'e çevirdi
```sql
UPDATE auth.users SET email_change = COALESCE(email_change, '');
```

### 2. PostgREST FK Disambiguation
**Problem**: order_tasks'ta iki FK profiles'a gittiği için HTTP 300 hatası
**Çözüm**: FK constraint adını belirttik
```typescript
profiles!order_tasks_assigned_to_fkey
```

### 3. Schema Cache Reload
**Problem**: Yeni sütunlar eklenince PostgREST cache'i güncellenmiyordu
**Çözüm**: NOTIFY pgrst, 'reload schema';

## Gelecek Geliştirmeler
- Depodan hazırlama ve kesim girişi modülleri
- stock_ready_kg ve production_ready_kg otomatik güncelleme
- Daha detaylı üretim planlama UI
- Raporlama ve analitik
- Mobil uygulama desteği

## Deployment Notları
- Vercel Edge Functions
- Supabase backend
- Ortam değişkenleri: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
- Build komutu: npx next build
