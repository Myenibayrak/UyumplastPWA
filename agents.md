# Uyum Plastik Sipariş Yönetim Sistemi - Geliştirme Oturumu

## Tarih
8 Şubat 2026 - 23:50 UTC+03

## Kullanıcı İstekleri ve Hedefler
1. **Login Sorunu**: Adminden başka kullanıcılar giremiyordu
2. **Sipariş Görünüm Sorunu**: Siparişler tabloda görünmüyordu
3. **Sipariş Hazır Durumu**: Depodan ve imalattan gelen kg'ları ayrı ayrı gösterme, %95 kuralı ile "HAZIR" statüsü
4. **Kaynak Seçimi**: Sipariş oluştururken hem stoktan hem üretimden aynı anda seçebilme (both)
5. **Evrak Kesme**: İmren (muhasebe) ve admin için sipariş kapatma butonu
6. **Geçmiş Siparişler**: Kapatılan/iptal edilen siparişleri geçmiş tabına taşıma, sadece belirli kullanıcılar için
7. **Üretim Planlama**: Bekleyen siparişlerin üretim planlamasında görünmesi

## Yapılan Değişiklikler

### 1. Veritabanı Migrasyonları
```sql
-- orders tablosuna yeni alanlar eklendi
ALTER TABLE orders ADD COLUMN stock_ready_kg numeric(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN production_ready_kg numeric(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN closed_by uuid REFERENCES public.profiles(id);
ALTER TABLE orders ADD COLUMN closed_at timestamptz;

-- source_type enum'üne 'both' seçeneği eklendi
ALTER TYPE source_type ADD VALUE 'both';
```

### 2. TypeScript Tip Güncellemeleri
```typescript
// lib/types.ts
export interface Order {
  // ... mevcut alanlar
  source_type: "stock" | "production" | "both";
  stock_ready_kg: number;
  production_ready_kg: number;
  closed_by?: string;
  closed_at?: string;
}

export type OrderStatus = "draft" | "pending" | "in_progress" | "shipped" | "delivered" | "cancelled" | "closed";
```

### 3. Validasyon Güncellemeleri
```typescript
// lib/validations.ts
export const orderCreateSchema = z.object({
  source_type: z.enum(["stock", "production", "both"]),
  // ... diğer alanlar
});

export const orderUpdateSchema = z.object({
  status: z.enum(["draft", "pending", "in_progress", "shipped", "delivered", "cancelled", "closed"]),
  // ... diğer alanlar
});
```

### 4. Sipariş Formu Güncellemeleri
```typescript
// components/orders/order-form.tsx
const sourceTypeOptions = [
  { value: "stock", label: "Stoktan", color: "bg-blue-100 text-blue-800" },
  { value: "production", label: "Üretim", color: "bg-orange-100 text-orange-800" },
  { value: "both", label: "Stok+Üretim", color: "bg-purple-100 text-purple-800" }
];
```

### 5. Sipariş Tablosu Güncellemeleri
```typescript
// components/orders/order-table.tsx
// Hazır durumu gösteren yeni sütun
{
  id: "ready_status",
  header: "Hazır Durumu",
  cell: ({ row }) => {
    const order = row.original;
    const totalReady = (order.stock_ready_kg || 0) + (order.production_ready_kg || 0);
    const readyPercent = (totalReady / order.quantity) * 100;
    const isReady = readyPercent >= 95;
    
    return (
      <div className="space-y-1">
        <div className="text-sm font-medium">
          {totalReady.toFixed(0)} / {order.quantity} kg
        </div>
        <div className="flex gap-1 text-xs">
          <span className="text-blue-600">Depo: {order.stock_ready_kg || 0}</span>
          <span className="text-orange-600">İmalat: {order.production_ready_kg || 0}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className={`h-2 rounded-full ${isReady ? "bg-green-500" : "bg-yellow-500"}`}
            style={{ width: `${Math.min(readyPercent, 100)}%` }}
          />
        </div>
        {isReady && (
          <Badge className="bg-green-100 text-green-800 text-xs">HAZIR</Badge>
        )}
      </div>
    );
  }
}

// Evrak Kes butonu
{
  id: "actions",
  header: "İşlemler",
  cell: ({ row }) => (
    <div className="flex gap-1">
      {canEdit && (
        <Button size="sm" onClick={() => onAddTask(row.original)}>
          + Görev
        </Button>
      )}
      {canClose && row.original.status !== "closed" && (
        <Button 
          size="sm" 
          variant="destructive"
          onClick={() => onCloseOrder(row.original.id)}
        >
          Evrak Kes
        </Button>
      )}
    </div>
  )
}
```

### 6. Sipariş Sayfası Tab Yapısı
```typescript
// app/dashboard/orders/page.tsx
const OrdersPage = () => {
  const [activeTab, setActiveTab] = useState("active");
  
  // Geçmiş tabı sadece belirli kullanıcılar için
  const canViewHistory = ["mustafa", "muhammed", "admin", "imren"].includes(auth.user?.user_metadata?.full_name?.toLowerCase());
  
  const filteredOrders = orders.filter(order => {
    if (activeTab === "active") {
      return !["closed", "cancelled"].includes(order.status);
    } else {
      return ["closed", "cancelled"].includes(order.status);
    }
  });
  
  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList>
        <TabsTrigger value="active">Aktif Siparişler</TabsTrigger>
        {canViewHistory && <TabsTrigger value="history">Geçmiş</TabsTrigger>}
      </TabsList>
      <TabsContent value="active">
        <OrderTable orders={filteredOrders} canClose={canClose} />
      </TabsContent>
      <TabsContent value="history">
        <OrderTable orders={filteredOrders} canClose={false} />
      </TabsContent>
    </Tabs>
  );
};
```

### 7. API Güncellemeleri
```typescript
// app/api/orders/route.ts
// FK disambiguation - HTTP 300 hatası için
const { data, error } = await supabase
  .from("orders")
  .select("*, order_tasks(id, department, status, assigned_to, assignee:profiles!order_tasks_assigned_to_fkey(full_name))")
  .order("created_at", { ascending: false });

// POST - both source_type için bildirim
if (parsed.data.source_type === "production" || parsed.data.source_type === "both") {
  // Üretim ve admin kullanıcılara bildirim gönder
}

// app/api/orders/[id]/route.ts
// PATCH - Sipariş kapatma
if (parsed.data.status === "closed") {
  updateData.closed_by = auth.userId;
  updateData.closed_at = new Date().toISOString();
}
```

### 8. Üretim Planlama Güncellemeleri
```typescript
// app/dashboard/production/page.tsx
const loadPendingOrders = useCallback(async () => {
  const res = await fetch("/api/orders");
  if (res.ok) {
    const all: Order[] = await res.json();
    const prodOrders = all.filter((o) => 
      (o.source_type === "production" || o.source_type === "both") && 
      !["shipped", "delivered", "cancelled", "closed"].includes(o.status)
    );
    setPendingOrders(prodOrders);
  }
}, []);
```

## Kritik Bug Fix'ler

### 1. Login Hatası - "Database error querying schema"
**Sorun**: Auth loglarında `email_change` sütununun NULL olması nedeniyle GoTrue scan hatası
**Çözüm**: Tüm kullanıcıların NULL string alanlarını boş string'e çevirdi
```sql
UPDATE auth.users SET
  email_change = COALESCE(email_change, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, '')
WHERE email LIKE '%uyumplast.com';
```

### 2. Siparişler Görünmüyor - HTTP 300 Multiple Choices
**Sorun**: `order_tasks` tablosunda `assigned_to` ve `assigned_by` FK'larının aynı `profiles` tablosuna referans vermesi
**Çözüm**: FK disambiguation ile hangi constraint'in kullanılacağını belirttik
```typescript
// Önce: assignee:profiles(full_name)
// Sonra: assignee:profiles!order_tasks_assigned_to_fkey(full_name)
```

## Mevcut Durum
- ✅ Login sorunu çözüldü (tüm kullanıcılar giriş yapabiliyor)
- ✅ Siparişler tabloda görünüyor
- ✅ Hazır durumu breakdown ve %95 kuralı çalışıyor
- ✅ Stok+Üretim seçeneği eklendi
- ✅ Evrak Kes butonu eklendi
- ✅ Aktif/Geçmiş tab yapısı kuruldu
- ✅ Üretim planlaması bekleyen siparişleri gösteriyor
- ⚠️ UI iyileştirmeleri ve son bug fix'ler bekleniyor

## Notlar
- `stock_ready_kg` ve `production_ready_kg` alanları şu an 0, depodan hazırlama ve kesim girişi yapıldıkça güncellenecek
- Geçmiş tabı sadece Mustafa, Muhammed, admin, İmren için görünür
- Accounting rolü de sipariş kapatabilir (PATCH endpoint'e eklendi)
- PostgREST schema cache reload edildi
