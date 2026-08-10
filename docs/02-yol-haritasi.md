# Yol haritası ve uyumluluk politikası

Bulgu kimlikleri için bkz. [`01-bulgular.md`](01-bulgular.md).
**Bu plan `laputa-backend` doğrulamasından sonra revize edildi** — ilk taslakla
farkları "Revizyon notu" başlıklarında.

## Sıralama ilkesi

1. **Önce ağ, sonra trapez.** Kırıcı değişikliği yakalayan mekanizma, kırıcı
   değişiklikten önce kurulur.
2. **Kırıcı maddeler tek sürüme toplanır.** Tüketiciyi iki kez göç ettirme.
3. **Doğrulanmamış bulgu implemente edilmez.** `C-3` bu kuralın bir modülü
   eklemekten kurtardığı canlı örnek.
4. **Kanıtı olan iş önce.** İki bağımsız projede çıkan bir boşluk, bir projede
   çıkandan önce gelir.

---

## Adım 0 — Tüketici duman testi (`T-6`) · ✅ TAMAMLANDI

**Neden ilk sırada:** Bir özellik değil, **bulgu üreten mekanizma**. Tek başına
`C-1`'i yakalardı — core'un mevcut testleri `/http`'i her zaman tüm peer'lar
kurulu ortamda import ediyor, tüketici ortamını hiç simüle etmiyor.

### ✅ Katman A — bağımlılık sözleşmesi testi (tamamlandı)

`tests/dependency-contract.test.ts` + `tests/support/`. Kurulum yapmadan, her
`exports` alt yolunun import grafiğini `Bun.Transpiler` ile çıkarır ve bildirilen
peer sözleşmesine karşı doğrular. `bun test` içinde koştuğu için **CI değişikliği
gerekmedi**.

Tasarım kararları:

- **`Bun.Transpiler.scanImports`** kullanılır; `import type` satırlarını tam da
  çalışma anındaki gibi düşürür → sonuç, gerçek çözünürlükle örtüşür.
- **Sözleşme iki yönlü zorlanır.** Bildirilmemiş peer → kırılır (vaat bozuldu);
  bildirilen ama artık gerekmeyen peer → kırılır (bildirim bayat).
- **Varsayılan en katı.** Politikada adı geçmeyen alt yol hiçbir opsiyonel
  peer'a uzanamaz; `exports`a yeni giriş eklenince kural kendiliğinden uygulanır.
- **Analiz ile politika ayrı.** `support/module-graph.ts` olgu üretir, hüküm
  vermez; sözleşme test dosyasında durur.

Sonuç, gerçek tüketici ortamında **çapraz doğrulandı** (yalnızca `hono`+`zod`+
`pino` kurulu bir projede her alt yol tek tek import edildi; statik testle birebir
aynı sonuç):

```
peer'sız yüklenen:  /auth /cache /config /http /i18n /logger /ratelimit /rbac /storage
peer gerektiren:    /http/validation → @hono/zod-validator    /db  → drizzle-orm
                    /mail → nodemailer   /metrics → prom-client
                    /notifications → web-push   /redis → ioredis
```

### ✅ Katman B — tüketici uyum kontrolü (tamamlandı)

`scripts/check-consumer.ts` + `scripts/support/`. Kullanım:

```sh
bun run check:consumer <tüketici-proje-yolu>
```

**Salt-okunur.** Tüketicinin kaynağını yalnızca okur: kurulum yapmaz,
`node_modules`'üne yazmaz, hiçbir dosyasını değiştirmez. İki kontrol:

1. **Alt yol** — import edilen her alt yol `exports` haritasında hâlâ var mı?
2. **Yüzey** — ifadelerdeki isimler (değer **ve tip**) hâlâ export ediliyor mu?

Tasarım kararı — **isimlere `tsc` karar verir.** Core'un export yüzeyini elle
çıkarmak denendi ve reddedildi: `Bun.Transpiler.scan()` yalnızca DEĞER
export'larını görüyor, tip-only export'ları (`type RbacVariables`,
`type AuthzContext`) görmüyor. laputa'nın core import'larının önemli kısmı tip
olduğu için bu yol yanlış alarm üretirdi. Bunun yerine ifadeler sentetik bir
projeye yazılıp core'un kendi `tsconfig`'iyle derlenir; kararı zaten derleyici
verir.

Tanılar tüketici kaynağına geri eşlenir — `tsc` `module-33.ts` der, rapor
kırılan ifadeyi ve onu kullanan dosyaları gösterir.

**Üç kırılma sınıfı da deneyle doğrulandı** (core geçici olarak bozulup geri
alındı):

| Deney | Sonuç |
|---|---|
| Değer export'u kaldır (`isHttpError`) | ✅ `src/shared/utils/error.util.ts` gösterildi |
| **Tip-only export kaldır** (`RbacVariables`) | ✅ 3 tüketici dosyası gösterildi |
| `exports`tan alt yol kaldır (`/i18n`) | ✅ 14 başvuru listelendi |

Sağlıklı durumda laputa-backend: **74 import ifadesi, 38 benzersizi derlendi,
uyumlu.** Bu, `C-1`'in "etkisi sıfır" bulgusunu bağımsız olarak doğruluyor.

**Kapsam sınırı (bilinçli):** Çağrı imzaları doğrulanmaz — yalnızca import
yüzeyi. `enforce(authz)` → `enforce(authz, user)` gibi bir değişiklik
geriye uyumlu olduğu için zaten kırmaz; kırıcı bir imza değişikliği yapılırsa
tüketicinin tamamı derlenmelidir. v0.3'e gelindiğinde tekrar değerlendirilecek.

**CI notu:** Katman A `bun test` içinde otomatik koşar. Katman B tüketici yolu
istediği ve laputa özel bir depo olduğu için şimdilik **yerel** bir komuttur;
sürüm çıkmadan elle koşulur (bkz. yayın kontrol listesi).

**Katman B — gerçek tüketici testi.** `bun-hono-starter` + **`laputa-backend`**
çekilip core `HEAD`'ine karşı `typecheck` + `test` koşturulur.

> **Revizyon notu:** laputa-backend'i Katman B'ye eklemek artık kanıtlanmış
> değerde — bu oturumda onun kaynağı 4 yeni/düzeltilmiş bulgu üretti
> (`C-9`, `C-10`, `C-11` ve `C-3` düzeltmesi). Core'un en iyi test cihazı o.
> Özel repo ise CI token'ı gerekir; başlangıçta yerel script olarak da yeter.

**Etki:** Yok — sadece CI.

---

## v0.2.0 — Küçük düzeltmeler + tek kırıcı madde

> **Revizyon notu:** `C-3` (requestId middleware) bu sürümden **çıkarıldı** —
> Hono zaten sağlıyor, yerine iki satır doküman. `C-1`'in laputa'ya etkisi
> **sıfır** çıktı, dolayısıyla bu sürüm pratikte risksiz.

| Madde | İş | Kırıcı? | laputa etkisi |
|---|---|---|---|
| ~~`C-1`~~ | ✅ **Yapıldı** — `createValidator` → `./http/validation` | Evet | **Yok** (kullanmıyor) |
| `T-2` | `badRequestFromZod` köprüsünü ayır — aynı dosya, `C-1` ile birlikte | Hayır | Yok |
| `C-4` | `generatePassword` karakter sınıfı düzeltmesi + invaryant testi | Hayır | Yok |
| `C-6` | `LocalDiskStorage` iç içe key desteği | Hayır | Yok |
| `C-3` | README + JSDoc: "`hono/request-id` ile eşleşir" | Hayır | Yok |
| `C-2`① | README: `@types/bun` zorunlu | Hayır | Yok |
| `C-2`② | `NodeJS.Signals` bağımlılığını düşür | Hayır | Yok |
| `C-7` | `drizzle-orm` peer aralığına üst sınır | Hayır | Yok |
| `C-8` | `shutdown` + `config` + `validation` testleri | Hayır | Yok |

**Tüketici göç notu** (gelecek tüketiciler için; laputa'da karşılığı yok):

```diff
- import { createValidator } from "@mustafakurtt/hono-core/http";
+ import { createValidator } from "@mustafakurtt/hono-core/http/validation";
```

---

## v0.3.0 — RBAC/auth kompozisyonunu aç (`C-11`: `C-5`+`C-9`+`C-10`+`T-3`)

Kataloğun **en yüksek değerli işi**. Dört bulgu tek bir dönüşümle kapanıyor.

> **Revizyon notu:** İlk taslakta bu yalnızca "fabrika dönüşümü" (`C-5`) idi.
> laputa incelemesi iki şey daha ekledi (`C-9` `enforce` imzası, `C-10` generic
> anahtar) ve asıl semptomu görünür kıldı (`C-11`: `guard()` tüketicide ölü kod).

Yapılacaklar:

1. **`createAuth({ verify, extract })`** — token çıkarıcı enjekte edilebilir,
   varsayılan Bearer. `T-3`'ü kapatır.
2. **`enforce(authz, user)`** — kancaya claim'ler de geçsin. `C-9`'u kapatır,
   geriye uyumlu (dar imza geniş imzaya atanabilir).
3. **`createRbac<PermissionKey>({...})`** — izin anahtarı generic. `C-10`.
4. **`guard()` kompozisyonu açılabilir** — ekstra adım eklenebilsin
   (`requireCurrentSession` gibi). `C-11`.
5. Mevcut `setTokenVerifier` / `configureRbac` / `authMiddleware` / `guard`
   bunların süreç-genelinde tek örneği olarak **aynen çalışmaya devam eder**.

**Kabul ölçütü — iki tane, ikisi de somut:**

- İki bağımsız app örneği aynı süreçte, farklı yapılandırmayla ayağa kalkabiliyor
  (bugün imkânsız).
- **`laputa-backend/src/shared/rbac/guard.ts` core'un fabrikasıyla ~5 satıra
  iniyor.** İnmiyorsa tasarım henüz doğru değil — bu, `C-11`'in gerçek testi.

---

## v0.4.0 — İki yol ayrımı: `CompositeKeyRepository` (`T-4`) ve `db:bootstrap` (`T-1`)

> **Revizyon notu:** İlk taslakta `T-1` v0.4'te tekti ve `T-4` "sürümlenmemiş"
> listedeydi. Doğrulama `T-4`'ü büyüttü (2 tablo değil **11 tablo**, i18n *ve*
> RBAC join tabloları) — artık `T-1` ile aynı ağırlıkta.

**`T-4` — `CompositeKeyRepository`.** Kanıt en güçlü olan madde: core'un kendi
RBAC şeması (`rolePermissions`, `userRoles`, `userPermissions`) bile core'un
veri katmanına sığmıyor. `findByKey` / `upsert` / `deleteByKey` üzerinden ayrı
bir sınıf; `BaseRepository`'yi `IdOf` etrafında karmaşıklaştırma. **`upsert`
unutulmamalı** — bileşik anahtarlı tabloların asıl ihtiyacı ve bugün core'da hiç
yok.

**`T-1` — `db:bootstrap`.** En yüksek ürün değeri, en çok tasarım gerektiren
madde. Önce port tasarla (`PermissionCatalog` → `PermissionStore`), bootstrap'ı
portun üstüne yaz, **bellek adaptörüyle** test et — core DB'ye bağlanmamalı
(mevcut `CacheStore`/`StorageStore` felsefesi). Taşınacak olan kod değil
kurallar: idempotentlik, açıklama güncelleme, çıkarılan yetkinin bağını
kaldırma, cache düşürme, raporlama, **kendi katalog kopyasını tutmama**.

`laputa/src/db/bootstrap.ts` (231 satır) referans implementasyon olarak
kullanılabilir — ama olduğu gibi taşınmaz, port arkasına alınır.

---

## Sürümlenmemiş / paralel yürüyen kararlar

| Konu | Aksiyon | Durum |
|---|---|---|
| `T-5` audit predikatı | `auditTrail`'e `shouldAudit(c)` opsiyonu; varsayılan bugünkü `SKIP_METHODS`. laputa'nın export uç workaround'u silinebilir hale gelir. | v0.3'e sığar |
| `T-4` dinamik tablo | Kod değil **doküman**: "bu durumda elle yaz, işte deseni". | Düşük öncelik |
| `T-7` sürüm kilidi | — | ✅ Zaten çözülmüş (`#v0.1.0`) |
| `T-8` uniclub çatallanması | **Karar ver, erteleme.** Üç seçenek `01-bulgular.md`'de. | ⏳ Sende |

---

## Uyumluluk politikası

1. **Kırıcı değişiklik biriktirilir.** Tek tek yayınlanmaz; bir sonraki minor
   sürüme toplanır, göç notu birebir diff olarak yazılır.
2. **Varsayılan davranış korunur.** Yeni yetenek opsiyonel parametreyle gelir;
   varsayılanı değiştirmek — imza aynı kalsa bile — kırıcı sayılır.
3. **Yeni subpath eklemek kırıcı değildir**, subpath kaldırmak/taşımak kırıcıdır.
4. **Tüketici envanteri güncel tutulur** ([`README.md`](README.md)).
5. **Her sürüm etiketlenir**, tüketiciler etikete bağlanır (`#v0.2.0`),
   `main`'e değil. (laputa bunu zaten doğru yapıyor.)
6. **Politika core'a girmez.** Bir özellik "hangi rol / hangi metin / hangi
   metot" kararı içeriyorsa dikiş olarak dışarı verilir.
7. **🆕 Hono'nun zaten yaptığı şey core'a girmez.** Yeni bir middleware/yardımcı
   önerilmeden önce Hono'da karşılığı aranır (`C-3` dersi).

## Bir bulgu nasıl kapatılır

1. `T-n` ise: önce core'da **başarısız bir test** yaz. Yeniden üretilemiyorsa
   "yeniden üretilemedi" notu düş ve kapat.
2. Etki analizini **tüketici kaynağında ölç**, tahmin etme — `C-1`/`C-3`/`T-4`
   üçü de tahminle yanlış boyutlandırılmıştı.
3. Düzelt, testi yeşile çevir.
4. Duman testi (`Adım 0`) yeşil mi?
5. Bulgu notuna sonucu ve hangi sürümde çıktığını işle.
