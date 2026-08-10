# Sürüm notları

Bu klasör core'un **tüketiciye bakan** değişiklik günlüğüdür. Hedef kitlesi
core'u geliştiren biz değil, **tüketici projelerde çalışan ajanlar ve
geliştiricilerdir**: laputa-backend, uniclub-backend, bun-hono-starter.

Bu yüzden buradaki notlar "ne yaptık"tan çok **"sende ne değişiyor, ne yapman
gerekiyor, nasıl doğrularsın"** sorularını cevaplar. Core'un iç gerekçeleri
[`../01-bulgular.md`](../01-bulgular.md) ve [`../02-yol-haritasi.md`](../02-yol-haritasi.md)
dosyalarında kalır; oraya bağlantı verilir, içerik kopyalanmaz.

## Dosya düzeni

| Dosya | Ne zaman |
|---|---|
| [`yayinlanmamis.md`](yayinlanmamis.md) | Yayınlanmamış değişiklikler burada **birikir**. Tüketiciye bakan her değişiklikte güncellenir. |
| `v0.2.0.md`, `v0.3.0.md` … | Sürüm etiketlendiğinde `yayinlanmamis.md` bu ada taşınır, yerine boş bir taslak açılır. |
| `gecis-<tüketici>-<aralık>.md` | **Geçiş rehberi.** Bir tüketici birden çok sürüm atlayacaksa yazılır: sürüm notları core'un ne değiştiğini, rehber o projede hangi dosyanın ne olacağını anlatır. Tüketici kaynağı okunarak yazılır. |
| [`SABLON.md`](SABLON.md) | Yeni not yazarken kopyalanacak iskelet. |

Mevcut rehber: [`gecis-laputa-v0.1-v0.4.md`](gecis-laputa-v0.1-v0.4.md).

## Çalışma kuralı

**Tüketiciye bakan her commit, `yayinlanmamis.md`'yi aynı commit içinde
günceller.** Sonradan toplamak işe yaramıyor: değişikliğin gerekçesi ve etkisi
en iyi yazıldığı anda bilinir.

Neyin "tüketiciye bakan" sayıldığı:

| Sayılır | Sayılmaz |
|---|---|
| `exports` haritası değişikliği | İç refactor, dosya taşıma |
| Export edilen bir ismin eklenmesi/kaldırılması/yeniden adlandırılması | Yorum, doküman düzeltmesi |
| İmza veya varsayılan davranış değişikliği | Core'un kendi testleri/araçları |
| Peer bağımlılık gereksinimi değişikliği | CI yapılandırması |
| Hata mesajı/kodu gibi sözleşme değişiklikleri | — |

Şüphedeysen yaz: fazladan bir satır, kaçırılmış bir kırılmadan ucuzdur.

## Bir notu tüketici ajanına verme

Notu olduğu gibi yapıştırıp şu yönergeyle ver:

```text
Aşağıdaki sürüm notu, bu projenin kullandığı @mustafakurtt/hono-core
paketindeki değişiklikleri anlatıyor. Sırasıyla:

1. "Etki" bölümünü oku ve BU projenin etkilenip etkilenmediğini belirle.
2. Etkileniyorsa "Yapılacaklar"daki adımları uygula — adımların dışına çıkma.
3. "Doğrulama"daki komutları koştur ve çıktılarını raporla.
4. "Dikkat" bölümündeki maddeleri kontrol et.
5. Emin olmadığın bir yer varsa DUR ve sor; tahminle değişiklik yapma.

Paket sürümünü package.json'da etikete kilitli tut (örn. #v0.2.0);
main'e bağlanma.

--- SÜRÜM NOTU ---
<notu buraya yapıştır>
```

## Core tarafında yayın öncesi kontrol listesi

Sürüm etiketlemeden önce:

1. `bun run typecheck` — temiz
2. `bun test` — yeşil (bağımlılık sözleşmesi testi dahil)
3. `bun run check:consumer <her tüketici yolu>` — her biri yeşil
4. `yayinlanmamis.md` eksiksiz mi; "Etki" bölümü her bilinen tüketici için dolu mu
5. `package.json` içindeki `version` yükseltildi mi
6. `yayinlanmamis.md` → `v<sürüm>.md` olarak taşındı, yerine `SABLON.md`'den
   boş taslak açıldı
7. Etiket atıldı ve tüketicilere not iletildi
