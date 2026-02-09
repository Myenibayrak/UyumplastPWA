# Rol ve Yetki Matrisi (Uyumplast OMS)

Bu dosya uygulamadaki iş akışını ve yetki modelini tek yerde toplar.

## Roller

| Rol | Operasyon Odağı | Kritik Yetkiler |
|---|---|---|
| `admin` | Tüm sistem yönetimi | Tüm ekranlar, ayarlar, stok düzenleme/silme, sipariş kapama |
| `sales` | Sipariş ve planlama koordinasyonu | Sipariş oluşturma/düzenleme, görev atama, finans görme |
| `accounting` | Evrak ve stok giriş takibi | Sipariş kapama, stok kartı ekleme (toplu dahil), finans görme |
| `warehouse` | Depo operasyonu | Depo giriş ekranı, kendi görevleri, stok düzenleme |
| `production` | Üretim operasyonu | Bobin girişi, kesim/bobin süreç yönetimi, kendi görevleri |
| `shipping` | Sevkiyat operasyonu | Kendi görevleri ve sipariş görünümü |

## İş Kuralı Notları

- Stok görünürlüğü kuralı: `admin`, `sales`, `accounting` + isim bazlı özel erişim (`muhammed`, `mustafa`, `fabrika müdürü`).
- Sipariş hazır kararı: `(stock_ready_kg + production_ready_kg) / quantity >= %95`.
- Görevlerim ekranı veri giriş yeri değildir; durum/öncelik takibi içindir.
- Şeffaflık ekranı (`/dashboard/transparency`) yönetim rollerine açıktır ve audit logları listeler.
