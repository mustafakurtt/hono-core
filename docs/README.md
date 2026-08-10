# hono-core — geliştirme notları

Bu klasör core'un **kendi geliştirme defteridir**. Kullanım kılavuzu değildir
(o kökteki `README.md`); burada "ne bulduk, neden değiştiriyoruz, mevcut
projeleri nasıl kırmadan yapıyoruz" tutulur.

## Dosyalar

| Dosya | İçerik | Kime |
|---|---|---|
| [`01-bulgular.md`](01-bulgular.md) | Bulgu kataloğu. Her bulgunun kimliği, kanıtı, önerilen düzeltmesi ve **mevcut projelere etkisi**. | Core geliştiricisi |
| [`02-yol-haritasi.md`](02-yol-haritasi.md) | Bulguların sürümlere dağıtımı, uyumluluk politikası, tüketici duman testi. | Core geliştiricisi |
| [`surumler/`](surumler/) | **Tüketiciye bakan** değişiklik günlüğü: sende ne değişti, ne yapman gerekiyor, nasıl doğrularsın. | **Tüketici projeler ve ajanları** |

İki kitleyi ayrı tutuyoruz: `01`/`02` core'un iç muhasebesidir, `surumler/`
dışarıya verilir. Tüketiciye bakan her commit `surumler/yayinlanmamis.md`'yi
aynı commit içinde günceller — bkz. [`surumler/README.md`](surumler/README.md).

## Bulgu kimlikleri ve güven seviyesi

Bulgular iki kaynaktan geliyor ve **karıştırılmamalıdır**:

- **`C-n` — Core incelemesi.** Bu depoda, bu oturumda çalıştırılarak
  doğrulandı. Her birinin altında yeniden üretilebilir kanıt var.
- **`T-n` — Tüketici raporu.** Core'u kullanan projelerde çalışan ajandan
  geldi. **Core deposunda doğrulanmadı** — ilgili proje repolarına erişim yok.
  Kabul edilmeden önce core tarafında yeniden üretilmeli.

Bir `T-n` doğrulandığında notuna kanıt eklenir ve etiketi `T-n (doğrulandı)`
olur. Doğrulanamayanlar silinmez, "yeniden üretilemedi" notuyla kalır — aynı
şüphenin ikinci kez araştırılmasını önler.

## Çalışma kuralı: her değişiklik etki analiziyle gelir

Core artık tek projeye ait değil. Bir bulguyu kapatmadan önce şu üç soru
cevaplanır ve bulgunun notuna yazılır:

1. **Kırıcı mı?** Mevcut bir tüketicinin import'u/çağrısı bozuluyor mu?
2. **Geçiş maliyeti ne?** Kırıcıysa tüketicide kaç dosya, ne kadar iş?
3. **Eklemeli yapılabilir mi?** Varsayılanı koruyup yeni davranışı opsiyon
   olarak sunmak çoğu zaman mümkün — tercih edilen yol budur.

## Tüketici envanteri

Core'un bugün kim tarafından kullanıldığı. Kırıcı değişiklik kararları buna
göre verilir.

| Tüketici | Bağlanma şekli | Durum |
|---|---|---|
| **laputa-backend** | paket, **`#v0.1.0` kilitli** ✅ | Aktif ve **incelendi** (`C:\Users\mustafa\Desktop\laputa-projects\laputa-backend`). `typecheck` temiz. Core'un referans tüketicisi. |
| uniclub-backend | **vendor kopya** (paket değil) | Core buradan çıkarıldı (`8d54566`), proje hâlâ kendi kopyasını taşıyor. İki kopya ayrışmış — bkz. `T-8`. **Karar bekliyor.** |
| bun-hono-starter | paket | Başlangıç şablonu. Duman testinin ikinci adayı (`T-6`). |

### laputa-backend — core kullanım profili

Kırıcı karar verirken bakılacak tablo. Sayılar `grep` ile ölçüldü:

| Modül | Import | Not |
|---|---|---|
| `/auth` | 23 | En çok kullanılan. Ama `authMiddleware` **kullanılmıyor** — proje kendi çerez-öncelikli sürümünü yazmış (`T-3`). |
| `/i18n` | 14 | `defineCatalog` parite kilidi feature başına kullanılıyor. |
| `/rbac` | 11 | Parçalar kullanılıyor (`attachAuthz`, `requirePermission`, `auditTrail`) ama **`guard()` kullanılmıyor** (`C-11`). |
| `/db` | 10 | 7 repository `BaseRepository` extend ediyor. Kullanmayanlardan **yalnızca `settings.repository` bileşik anahtar yüzünden edemiyordu** (`T-4`); diğerleri ilişkisel/analitik sorgular — beklenen. |
| `/http` | 9 | `createValidator` **kullanılmıyor** → `C-1`'in etkisi sıfır. |
| `/logger` | 2 | |
| `/storage` `/redis` `/ratelimit` `/metrics` `/mail` `/config` `/cache` | 1'er | Tesisat; sorunsuz. |

**Okuma:** Core'un *tesisatı* (log, cache, storage, redis, mail, metrics,
ratelimit, i18n) sorunsuz çalışıyor. Sürtünmenin tamamı iki yerde toplanıyordu:
**RBAC/auth kompozisyonu** (`C-11`) ve **veri katmanı esnekliği** (`T-4`).
Yol haritası bu yüzden v0.3'ü birinciye, v0.4'ü ikinciye ayırdı.

> **Not:** Tablodaki "kullanılmıyor / edemiyor" maddeleri **core tarafında
> çözüldü** (v0.3.0 ve v0.4.0). Tüketici henüz yeni API'lere geçmedi; geçiş
> zorunlu değil, kazanç isteğe bağlı. Ayrıntı:
> [`surumler/v0.3.0.md`](surumler/v0.3.0.md) ve
> [`surumler/v0.4.0.md`](surumler/v0.4.0.md).

> ⚠️ Bu tablo elle tutuluyor. Yeni bir tüketici eklendiğinde buraya yazılmalı;
> yoksa kırıcı değişikliğin kimi vurduğu bilinemez.

## Kapsam sınırı — core'a girMEyecekler

Genelleme hevesi kütüphaneleri bozar. Aşağıdakiler bir tüketicide ne kadar iyi
çalışırsa çalışsın core'a taşınmaz; hepsi **ürün kararıdır**, tesisat değil:

- İçerik kayıt defteri (registry) deseni
- Analitik hash'leme, kampanya atıf mantığı
- Medya magic-byte doğrulama **politikası** (mekanizma olan `sniffImageMime`
  zaten core'da; hangi tipin kabul edileceği projede)
- Rol adları, izin katalogları, mesaj metinleri

Ölçüt: *"Bir sonraki proje bunu farklı isteseydi, core'u değiştirmek zorunda
kalır mıydı?"* Cevap evetse core'a girmez.
