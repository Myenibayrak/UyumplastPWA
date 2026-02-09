# Rol ve Yetki Matrisi (Uyumplast OMS)

Bu dosya uygulamadaki iş akışını ve yetki modelini tek yerde toplar.

## Roller

| Rol | Operasyon Odağı | Kritik Yetkiler |
|---|---|---|
| `admin` | Tüm sistem yönetimi | Tüm ekranlar, ayarlar, stok kartı ekleme/düzenleme/silme, sipariş kapama |
| `sales` | Sipariş ve planlama koordinasyonu | Sipariş oluşturma/düzenleme, görev atama, finans görme |
| `accounting` | Evrak ve stok giriş takibi | Sipariş kapama, stok kartı ekleme (toplu dahil), finans görme |
| `warehouse` | Depo operasyonu | Depo giriş ekranı, kendi görevleri, stok düzenleme |
| `production` | Üretim operasyonu | Bobin girişi, kesim/bobin süreç yönetimi, kendi görevleri |
| `shipping` | Sevkiyat operasyonu | Kendi görevleri, sevkiyat programında tamamlama |

## İş Kuralı Notları

- Stok görünürlüğü kuralı: `sales` + fabrika müdürü + isim bazlı özel erişim (`muhammed`, `mustafa`).
- Muhasebe stok göremez ama stok kartı toplu/hızlı giriş yapabilir (sadece giriş modu).
- Sipariş hazır kararı: `(stock_ready_kg + production_ready_kg) / quantity >= %95`.
- Görevlerim ekranı veri giriş yeri değildir; durum/öncelik takibi içindir.
- Şeffaflık ekranı (`/dashboard/transparency`) yönetim rollerine açıktır ve audit logları listeler.
- Canlı veri paneli (`/dashboard/data-entry`) sadece admin içindir ve satır bazlı girişleri izler.
