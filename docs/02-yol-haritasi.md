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

## v0.2.0 — Küçük düzeltmeler + tek kırıcı madde · ✅ TAMAMLANDI

> **Revizyon notu:** `C-3` (requestId middleware) bu sürümden **çıkarıldı** —
> Hono zaten sağlıyor, yerine iki satır doküman. `C-1`'in laputa'ya etkisi
> **sıfır** çıktı, dolayısıyla bu sürüm pratikte risksiz.

Hepsi yapıldı; etiketlenmeyi bekliyor. Tüketiciye bakan özet:
[`surumler/yayinlanmamis.md`](surumler/yayinlanmamis.md).

| Madde | İş | Kırıcı? |
|---|---|---|
| `C-1` | `createValidator` → `./http/validation` | Evet |
| `T-2` | `createZodErrorMapper` — kenar-bağımsız zod köprüsü | Hayır |
| `C-4` | `generatePassword` karakter sınıfı + invaryant testi | Hayır |
| `C-6` | `LocalDiskStorage` iç içe key desteği | Hayır |
| `C-3` | JSDoc: `hono/request-id` ile eşleşir | Hayır |
| `C-2` | README `@types/bun`; `NodeJS` ambient bağımlılığı düşürüldü | Hayır |
| `C-7` | `drizzle-orm` peer aralığına üst sınır | Hayır |
| `C-8` | `shutdown`, `config`, `LocalDiskStorage`, şifre, zod köprüsü testleri (90 → 144) | Hayır |

`C-8`'de `request-logger` testi hâlâ açık — v0.3'e taşındı.

**Yayın adımı:** `package.json` sürümü `0.2.0`'a çek, `yayinlanmamis.md`'yi
`v0.2.0.md` yap, etiketle. Bkz. [`surumler/README.md`](surumler/README.md).

**Tüketici göç notu** (gelecek tüketiciler için; laputa'da karşılığı yok):

```diff
- import { createValidator } from "@mustafakurtt/hono-core/http";
+ import { createValidator } from "@mustafakurtt/hono-core/http/validation";
```

---

## v0.3.0 — RBAC/auth kompozisyonunu aç · ✅ TAMAMLANDI

Dört bulgu (`C-5`, `C-9`, `C-10`, `T-3` → `C-11`) tek dönüşümle kapandı; `T-5`
ve `C-8` de yanında bitti. Tamamı **eklemeli** — kırıcı değişiklik yok.
Tüketiciye bakan özet: [`surumler/yayinlanmamis.md`](surumler/yayinlanmamis.md).

Eklenenler:

1. `createAuth({ verify, extract })` + `bearerToken`/`cookieToken`/`firstToken` — `T-3`
2. `enforce(authz, user)` — claim'ler kancaya geçer, geriye uyumlu — `C-9`
3. `createRbac<Key>({...})` — tipli izin anahtarı — `C-10`
4. `steps` — `attachAuthz` sonrası proje adımları — `C-11`
5. `shouldAudit` — denetim politikası dışarıdan — `T-5`
6. Singleton'lar (`configureRbac`, `setTokenVerifier`, `guard`) fabrikaların
   üzerine kurulu ince uyumluluk katmanına dönüştü; davranış aynı.

**Kabul ölçütü karşılandı, derlenerek kanıtlandı.** laputa'nın elle kurduğu
zincir 11 satıra iniyor ve projenin 40 satırlık kendi `auth.middleware.ts`'i
tamamen gereksizleşiyor:

```ts
const auth = createAuth({
  verify: verifyToken,
  extract: firstToken(cookieToken(SESSION_COOKIE), bearerToken),
});

export const { guard } = createRbac<PermissionKey>({
  auth: auth.middleware,
  getSubjectId: (user) => user.userId,
  resolveAuthz: loadAuthz,
  steps: [requireCurrentSession],
});
```

Ayrıca doğrulandı: `c.req.param()` tipleri korunuyor, var olmayan izin anahtarı
derleme hatası veriyor, iki bağımsız örnek aynı süreçte yaşayabiliyor.

**Zincir arity'si nasıl korundu:** proje adımları zincire ayrı eleman olarak
girmiyor; `hono/combine`'ın `every()`'siyle tek bir "policy" halkasına
katlanıyor. Böylece kaç adım eklenirse eklensin tuple uzunluğu sabit kalıyor —
Hono'nun rota overload'ları argüman sayısını derleme zamanında bilmek zorunda.
`guard`/`guardRole` de union yerine **overload** döndürüyor; union olsaydı
spread arity'yi çözemezdi.

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
