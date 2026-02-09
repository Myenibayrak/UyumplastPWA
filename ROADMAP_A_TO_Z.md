# Uyumplast OMS - A'dan Z'ye Gelişim Planı

Bu plan, karmaşık şirket akışını tek sistemde yönetmek için rol bazlı eksiklerin kapatılmasını hedefler.

## 1) Operasyon Çekirdeği (Tamamlanan)
- Siparişte `stock + production` birlikte kaynak desteği.
- `%95` hazır kuralı ve depo/imalat kg ayrımı.
- Sipariş kapama (`Evrak Kes`) ve aktif/geçmiş ayrımı.
- Sevkiyat programı: tarih-saat-sıra, gecikenlerin otomatik bugüne/ertesi güne devri.
- Direkt mesaj ve görev mesajı altyapısı.
- Admin canlı veri paneli (`/dashboard/data-entry`) ile satır bazlı şeffaflık.

## 2) Rol Bazlı Çalışma Modeli (Güncel)
- `admin (muhammed, mustafa)`: tüm yönetim, ayar, şeffaflık, canlı veri.
- `sales (harun, musa)`: sipariş, görev atama, dürtme, sevkiyat planlama.
- `production (esat, gökhan, mehmet ali)`: bobin/kesim üretim akışı, üretim planı.
- `warehouse (ugur, turgay)`: depo giriş, stok hareket operasyonu.
- `shipping (turgut)`: sevkiyat tamamlama.
- `accounting (imren)`: evrak kapama, blok/excel benzeri stok girişi.

## 3) Kritik Kural Seti (Güncel)
- Görevlerim ekranı sadece takip; veri girişi ilgili operasyon ekranında.
- Stok görünürlüğü sadece: satış + fabrika müdürü + Muhammed + Mustafa.
- Muhasebe stok görmeden giriş yapabilir (sadece giriş modu).
- Tüm kritik write işlemleri audit log'a yazılır.

## 4) Yeni Eklenen Modül
- Devir-Teslim (`/dashboard/handover`)
  - Departman bazlı vardiya notları
  - Açık/Çözüldü durum takibi
  - Yönetim rolleri tüm notları görür/yönetir
  - Diğer roller departman/oluşturduğu notlarla sınırlı çalışır

## 5) Sonraki Sprint (Önerilen)
- Sevkiyat kapasite planı: araç/rota/şoför bazlı kapasite kontrolü.
- SLA paneli: geciken görev/sipariş alarmı.
- Sipariş maliyet izi: fire, kesim verimi, reel maliyet.
- Çok adımlı onay akışı: yüksek öncelik sipariş için zorunlu onay.
- Operasyon rapor merkezi: rol bazlı günlük/haftalık performans çıktıları.
