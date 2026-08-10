# Bulgu kataloğu

Etiketler ve güven seviyesi için bkz. [`README.md`](README.md).
`C-n` = core deposunda doğrulandı · `T-n` = tüketici raporu, **doğrulanmadı**.

**Referans durum** (bulguların ölçüldüğü an — commit `8d54566`):

```
bun run typecheck   → temiz
bun test            → 90 pass / 23 skip (db: DATABASE_URL yok) / 0 fail
```

**Tüketici doğrulaması:** Tüm `T-n` bulguları `laputa-backend` üzerinde
doğrulandı (`C:\Users\mustafa\Desktop\laputa-projects\laputa-backend`,
`typecheck` temiz). Sonuçlar aşağıda her bulgunun altında.

---

## Özet tablo

| # | Bulgu | Ağırlık | Kırıcı mı? | Durum |
|---|---|---|---|---|
| C-1 | `/http` barrel'ı "opsiyonel" peer'ı zorunlu kılıyor | Yüksek | **Evet** (tek kırıcı madde) | ✅ **ÇÖZÜLDÜ** — laputa'ya etkisi sıfır |
| C-2 | Kaynak dağıtımı tüketiciye ambient tip bağımlılığı dayatıyor | Orta | Hayır (doküman) | ✅ ÇÖZÜLDÜ |
| C-3 | ~~`requestId` mekanizması yok~~ → doküman eksiği | **Düşük** | Hayır (doküman) | ⚠️ **Düzeltildi** — Hono zaten sağlıyor |
| C-4 | `generatePassword` "garantili çeşitlilik" iddiası tutmuyor | Düşük | Hayır (davranış düzeltmesi) | ✅ ÇÖZÜLDÜ |
| C-5 | Modül düzeyi singleton'lar tek-app varsayıyor | Yüksek (mimari) | Hayır (eklemeli) | ✅ ÇÖZÜLDÜ |
| C-6 | `LocalDiskStorage` iç içe key'leri desteklemiyor | Düşük | Hayır (hata düzeltmesi) | ✅ ÇÖZÜLDÜ |
| C-7 | `drizzle-orm` peer tabanı bir rc sürümü | Düşük | Hayır (metadata) | ✅ ÇÖZÜLDÜ |
| C-8 | Beş modülün hiç testi yok | Orta | Hayır | ✅ ÇÖZÜLDÜ (162 test) |
| C-9 | `enforce` kancası claim'leri göremiyor → oturum iptali sığmıyor | Yüksek | Hayır (eklemeli) | ✅ ÇÖZÜLDÜ |
| C-10 | `guard()` izin anahtarı üzerinde generic değil | Orta | Hayır (eklemeli) | ✅ ÇÖZÜLDÜ |
| C-11 | Sonuç: core'un `guard()`'ı tüketicide ölü kod | Yüksek | — | ✅ ÇÖZÜLDÜ — kabul ölçütü derlenerek kanıtlandı |
| T-1 | İzin kataloğu ↔ DB senkronu (`db:bootstrap`) yok | Yüksek | Hayır (eklemeli) | ✅ ÇÖZÜLDÜ |
| T-2 | Çalışma anında şema seçiminde ham `ZodError` → 500 | Yüksek | Hayır (eklemeli) | ✅ ÇÖZÜLDÜ |
| T-3 | `authMiddleware` yalnızca Bearer okuyor | Orta | Hayır (eklemeli) | ✅ ÇÖZÜLDÜ |
| T-4 | `BaseRepository` bileşik anahtarı karşılamıyor | **Yüksek** | Hayır (eklemeli) | ✅ ÇÖZÜLDÜ (dinamik tablo: bilinçli kapsam dışı) |
| T-5 | Denetim izinin "GET atla" politikası core'a gömülü | Orta | Hayır (eklemeli) | ✅ ÇÖZÜLDÜ |
| T-6 | Core CI'ında tüketici duman testi yok | Yüksek (süreç) | — | ✅ **ÇÖZÜLDÜ** (Katman A + B) |
| T-7 | Tüketicilerde core sürümü kilitli değil | ~~Yüksek~~ | — | ✅ **Zaten çözülmüş** (`#v0.1.0`) |
| T-8 | uniclub-backend ayrışmış vendor kopya taşıyor | Yüksek (süreç) | — | Karar bekliyor |

---

# C — Core incelemesi (doğrulandı)

## C-1 · `/http` barrel'ı "opsiyonel" peer'ı zorunlu kılıyor · ✅ ÇÖZÜLDÜ

> **Kapatıldı.** `createValidator` `./http/validation` alt yoluna taşındı,
> `/http` barrel'ından çıkarıldı. Gerçek tüketici ortamında doğrulandı:
> `/http` artık `@hono/zod-validator` kurulu olmadan 13 export ile yükleniyor.
> Regresyona karşı `tests/dependency-contract.test.ts` bekçilik ediyor.

**Ağırlık:** Yüksek — `/http` her projenin kullandığı tek modül.

`package.json` `@hono/zod-validator`'ı `peerDependenciesMeta.optional: true`
işaretliyor, kök README "opsiyoneldir" diyor. Gerçekte değil.

**Kanıt** — peer kurulu değilken, gerçek bir tüketici projesinde:

```ts
import { NotFoundError } from "@mustafakurtt/hono-core/http";
```
```
error: Cannot find module '@hono/zod-validator'
       from .../node_modules/@mustafakurtt/hono-core/src/http/validation.ts
```

Derleme tarafında da aynısı (`skipLibCheck: true` açıkken bile):
```
src/http/validation.ts(1,28): error TS2307: Cannot find module '@hono/zod-validator'
src/http/validation.ts(38,33): error TS7006: Parameter 'result' implicitly has an 'any' type
```

**Kök sebep:** [`src/http/index.ts`](../src/http/index.ts) `createValidator`'ı
re-export ediyor; [`src/http/validation.ts:1`](../src/http/validation.ts#L1)
`zValidator`'ı top-level import ediyor. Barrel'a dokunan herkes peer'ı çekiyor.

**Tüm subpath'ler tarandı.** Opsiyonel peer'ı sertleştiren tek yer bu.
`/db`, `/mail`, `/metrics`, `/redis`, `/notifications` de peer'sız patlıyor
ama orada bu **doğru** davranış — `/mail` import eden zaten nodemailer istiyor.

**Doğru desen zaten kodda var:** `RedisCacheStore` ioredis'i import etmiyor,
yapısal `RedisCacheClient` arayüzü alıyor (ISP notu dosyada yazılı). Bu yüzden
`/cache` ioredis'siz sorunsuz yükleniyor. `/http` sadece bu deseni izlemiyor.

**Önerilen düzeltme** (iki satır):

```jsonc
// package.json → exports
"./http": "./src/http/index.ts",
"./http/validation": "./src/http/validation.ts",   // + ekle
```
```ts
// src/http/index.ts → çıkar
export { createValidator, type CreateValidatorOptions } from "./validation";
```

**Mevcut projelere etkisi — laputa-backend'de ÖLÇÜLDÜ: sıfır.**

```
$ grep -rn "hono-core/http" src        # laputa-backend
createShutdownManager · createErrorHandler · createRequestLogger
ForbiddenError · isHttpError · createResponder · ValidationError
```

`createValidator` **hiç import edilmiyor**. Proje kendi
`src/shared/utils/validate.ts`'ini yazmış ve core'dan yalnızca
`ValidationError` sınıfını alıyor. Yani kataloğun tek kırıcı maddesi, bilinen
tek paket-tüketicisini **hiç etkilemiyor**.

> **Bu ayrıca `C-1`'den daha derin bir şeyi gösteriyor:** tüketici
> `createValidator`'ı kullanmamayı *seçmiş*, çünkü iki şeye ihtiyacı vardı ve
> core ikisini de vermiyordu — tipli mesaj anahtarı (`MessageKey`) ve issue
> parametrelerine göre çalışma anında üretilen alan mesajları. Bu, `T-2` ile
> aynı kökten: doğrulama biçimlendirmesi middleware'e yapışık.

Geçiş (gelecekteki bir tüketici için) tek satırlık import yolu değişikliği:

```diff
- import { createValidator } from "@mustafakurtt/hono-core/http";
+ import { createValidator } from "@mustafakurtt/hono-core/http/validation";
```

*Reddedilen alternatif:* barrel export'u koruyup peer'ı "zorunlu" ilan etmek.
Kırıcı olmazdı ama tasarımdan taviz olurdu — zod-validator kullanmayan
projeye gereksiz bağımlılık dayatır.

---

## C-2 · Kaynak dağıtımı tüketiciye ambient tip bağımlılığı dayatıyor

**Ağırlık:** Orta.

Build adımı olmaması Bun için zarif, ama core `.ts` olarak dağıtıldığı için
**tüketicinin `tsc`'si core'un kaynağını derliyor**. `skipLibCheck` işe
yaramıyor — bunlar `.d.ts` değil `.ts`. Core'un kendi `tsconfig.json`'ındaki
`"types": ["bun-types"]` de tüketiciye geçmiyor.

**Kanıt** — temiz bir tüketici projesinde, `skipLibCheck: true` açık:

```
src/auth/password.ts(8,9):    error TS2867: Cannot find name 'Bun'.
src/http/shutdown.ts(21,13):  error TS2503: Cannot find namespace 'NodeJS'.
src/http/shutdown.ts(40,24):  error TS2580: Cannot find name 'process'.
```

`@types/bun` eklenince tamamı temizlendi. Yani her tüketici `@types/bun`
kurmak **zorunda** — bu hiçbir yerde yazmıyor.

**Önerilen düzeltme (kademeli):**
1. *Şimdi:* kök README kurulum bölümüne `@types/bun`'ı zorunlu olarak yaz.
   Sıfır risk, sıfır kod.
2. *Sonra:* `shutdown.ts`'teki `NodeJS.Signals` bağımlılığını düşür —
   `type Signal = "SIGTERM" | "SIGINT" | (string & {})` yeterli. Bu, core'un
   Node ambient tiplerine olan tek bağını koparır.
3. *İleride, ancak gerekirse:* `.d.ts` + `.js` yayınlamak. Bun-dışı tüketici
   ihtiyacı doğmadan yapma — build adımı eklemenin bedeli yüksek.

**Mevcut projelere etkisi:** Yok. Bugün çalışan projelerde `@types/bun`
zaten kurulu (yoksa derlenmezlerdi). Bu bir **dokümantasyon** boşluğu; sadece
yeni projeleri ilk kurulumda vuruyor.

---

## C-3 · ⚠️ DÜZELTİLDİ — `requestId` bir mekanizma değil, doküman eksiği

**İlk değerlendirme yanlıştı.** Başlangıçta "core `requestId`'yi hiç set
etmiyor, bir middleware eklemeli" demiştim. Tüketiciyi inceleyince ortaya çıktı
ki **Hono bunu zaten sağlıyor** ve laputa-backend de onu kullanıyor:

```ts
// laputa-backend/src/index.ts
import { requestId } from "hono/request-id";
app.use("*", requestId());
```

```js
// hono/dist/middleware/request-id/request-id.js
c.set("requestId", reqId);       // ← core'un okuduğu anahtarın tam karşılığı
if (headerName) c.header(headerName, reqId);
```

Hono'nun middleware'i gelen `X-Request-Id`'yi koruyor, uzunluk/karakter
doğrulaması yapıyor, yoksa `crypto.randomUUID()` üretiyor — yani önerdiğim
implementasyonun **birebir aynısı, üstelik daha sağlamı**.

Yani core'un `c.get("requestId")` varsayılanı bir boşluk değil, `hono/request-id`
ile **kasıtlı bir uyum**. Sadece hiçbir yerde yazmıyor.

**Önerilen düzeltme:** Kod değil, iki satır doküman. Kök README'ye ve
`createErrorHandler` / `createRequestLogger` JSDoc'una:

> `requestId` varsayılanı `hono/request-id` middleware'i ile uyumludur:
> `app.use("*", requestId())` ekle, başka bir şey gerekmez.

**Bu düzeltmenin dersi kaydedilmeye değer:** core'a bir mekanizma eklemeden önce
"bunu Hono zaten yapıyor mu?" sorulmalı. `C-3`'ü doğrulamadan implemente
etseydik core'a, Hono'nun daha iyi bir sürümünü taşıyan gereksiz bir modül
girecekti — tam olarak bir çekirdek kütüphanenin şişmesi böyle başlar.

**Mevcut projelere etkisi:** Yok (kod değişmiyor).

---

## C-4 · `generatePassword` "garantili çeşitlilik" iddiası tutmuyor

**Ağırlık:** Düşük ama gerçek bir hata.

[`src/auth/password.ts`](../src/auth/password.ts) yorumu "İlk 4 karakter
garantili çeşitlilik" diyor. Alfabe indeks aritmetiği kaymış:

```
alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
büyük harf bloğu 24 karakter (I ve O çıkarılmış), 26 değil

alphabet[bytes[0] % 26]       → indeks 24,25 = 'a','b'        (küçük harf!)
alphabet[26 + bytes[1] % 26]  → indeks 49,50,51 = '2','3','4' (rakam!)
```

**Kanıt** — 20.000 üretim:

```
missing uppercase: 1  (0.01%)
missing lowercase: 4
missing digit    : 0
missing symbol   : 0
```

Oran düşük çünkü gövde genelde eksiği kapatıyor. Ama "garantili" değil: bir
şifre politikası kontrolü ("en az bir büyük harf") **nadiren ve rastgele**
patlar — teşhisi en zor hata sınıfı.

**Önerilen düzeltme** — sınıfları açıkça ayır:

```ts
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const prefix =
  UPPER[bytes[0] % UPPER.length] +
  LOWER[bytes[1] % LOWER.length] +
  DIGIT[bytes[2] % DIGIT.length] +
  symbols[bytes[3] % symbols.length];
```

**Mevcut projelere etkisi:** Yok. Yalnızca **yeni üretilen** geçici şifreleri
etkiler; saklanan hash'ler etkilenmez (hash algoritması değişmiyor). API imzası
aynı.

**Test borcu:** düzeltmeyle birlikte karakter-sınıfı invaryantı testi eklenmeli
— aksi halde aynı hata sessizce geri gelir.

---

## C-5 · Modül düzeyi singleton'lar tek-app varsayıyor

**Ağırlık:** Yüksek (mimari borç). Kök README'de "bilinen sınır" olarak
dürüstçe yazılmış — burada bedelini fiyatlıyoruz.

`configureRbac`, `configureTenantScope`, `setTokenVerifier`,
`setGuardAuditSink` modül düzeyinde state tutuyor. Bedeli:

- **Test izolasyonu.** Test dosyaları arasında sızıntı olur; her test global
  kurulum/temizlik yapmak zorunda. Paralel test dosyaları riskli.
- **Tek app kısıtı.** Aynı süreçte iki app (ana API + admin API, ya da bir
  entegrasyon test harness'ı) mümkün değil.
- **`authMiddleware` bir değer, fabrika değil.** Kullanan her yer zorunlu
  olarak global state'e bağlanıyor — kaçış yok.

Bu, `T-3`'ün (çerez auth) da kök sebebi: tüketici token çıkarımını
değiştiremediği için middleware'i baştan yazmış.

**Önerilen düzeltme — eklemeli, kırıcı değil.** Fabrikayı asıl form yap,
singleton'ı onun üzerine ince bir uyumluluk katmanı olarak bırak:

```ts
export function createAuth(opts: { verify: TokenVerifier; extract?: TokenExtractor }) {
  return { middleware: async (c, next) => { /* opts kullanır */ } };
}

// Geriye uyum: mevcut API bunun süreç-genelinde tek bir örneği olur.
const defaultAuth = /* lazy */;
export const authMiddleware = (c, next) => defaultAuth().middleware(c, next);
export const setTokenVerifier = (fn) => { /* defaultAuth'u yapılandırır */ };
```

Aynı deseni `createRbac({ getSubjectId, resolveAuthz, enforce })` için de kur.
`guard()` fabrika örneğinden türetilebilir hale gelir.

**Mevcut projelere etkisi:** Yok — mevcut `setTokenVerifier` + `authMiddleware`
çağrıları aynen çalışmaya devam eder. Ama bu, **v0.x penceresi kapanmadan**
yapılmalı; API dondurulduktan sonra bu dönüşüm çok daha pahalı olur.

---

## C-6 · `LocalDiskStorage` iç içe key'leri desteklemiyor

**Ağırlık:** Düşük.

**Kanıt:**
```
flat key      : OK
nested key    : FAIL - ENOENT ... '.tmp-storage\2026\08\a.png'
traversal     : blocked OK
```

`put` yalnızca `baseDir` için `mkdir` çağırıyor, `dirname(full)` için değil.
Tarih bazlı yerleşim (`2026/08/...`) yaygın bir ihtiyaç. Path traversal
savunması doğru çalışıyor — orada sorun yok.

**Önerilen düzeltme:** `mkdir(dirname(full), { recursive: true })`. Alternatif:
port sözleşmesine "key düz olmalı, `/` içeremez" yazıp `safePath`'te reddet.
İlki tercih edilir — S3 adaptörü zaten `/` içeren key'leri destekleyecek,
adaptörler Liskov-substitutable kalmalı.

**Mevcut projelere etkisi:** Yok — bugün çalışan hiçbir kullanım bozulmaz
(düz key'ler çalışmaya devam eder), sadece bugün patlayan bir durum düzelir.

---

## C-7 · `drizzle-orm` peer tabanı bir rc sürümü

`"drizzle-orm": ">=1.0.0-rc.4"` — rc'ler arasında kırıcı değişiklik olağandır
ve `>=` bunu serbest bırakıyor. `1.0.0` çıkana kadar üst sınır koymak
(`">=1.0.0-rc.4 <1.1.0"` gibi) daha güvenli.

**Mevcut projelere etkisi:** Yok (daraltma yalnızca yeni kurulumları etkiler),
ama `T-7` ile birlikte düşünülmeli — asıl risk tüketicilerin core'u
kilitlememesi.

---

## C-8 · Beş modülün hiç testi yok

90 test var ama şunlar kapsam dışı:
`shutdown`, `config`, `logger`, `request-logger`, `validation`.

En dikkat çekeni **`createShutdownManager`**: `onExit`'i *tam da test
edilebilsin diye* enjekte edilebilir yapmışsın ama testi yok. Timeout bütçesi
ve "bir görev fırlatsa diğerleri devam eder" davranışı sessizce bozulabilir —
ve bozulduğunda ancak üretimde bir deploy kilitlendiğinde fark edilir.

`validation`'ın testi `C-1` düzeltmesiyle birlikte yazılmalı (modül taşınıyor).

---

## C-9 · 🆕 `enforce` kancası claim'leri göremiyor — oturum iptali sığmıyor

**Ağırlık:** Yüksek. Tüketici incelemesinde bulundu; ajan raporunda yok.

Core'un sözleşmesi:

```ts
enforce?: (authz: AuthzContext) => void;   // yalnızca çözülmüş authz
```

`AuthzContext` = `{ roles, permissions }`. Token claim'leri (`c.get("user")`)
buraya **hiç ulaşmıyor**. Sonuç: claim'e dayanan hiçbir politika bu kancaya
sığmıyor — ve en yaygın olanı tam da bu: `tokenVersion` ile oturum iptali.

**Kanıt** — `laputa-backend/src/shared/rbac/guard.ts` yorumu birebir bunu
söylüyor:

> *"core'un `enforce` kancası yalnızca çözülmüş authz bağlamını görür, token
> claim'lerini görmez; dolayısıyla `tokenVersion` karşılaştırması oraya sığmaz.
> Zinciri burada kurunca `requireCurrentSession` doğru yere — `attachAuthz`ten
> hemen sonra, yetki kontrolünden önce — girer. İptal edilmiş oturum 403 değil
> 401 alır; doğru olan budur."*

Yani tüketici, core'un `guard()`'ını **sırf bu yüzden** yeniden kurmak zorunda
kalmış. Şifre değiştirince/çıkış yapınca tüm oturumları düşürmek jenerik bir
ihtiyaç, projeye özgü değil.

**Önerilen düzeltme** — kanca imzasını genişlet (eklemeli, kırıcı değil):

```ts
enforce?: (authz: AuthzContext, user: AuthClaims) => void;
```

Mevcut tek parametreli fonksiyonlar aynen çalışmaya devam eder (JS fazladan
argümanı yok sayar, TS'te dar imza geniş imzaya atanabilir).

`401` vs `403` ayrımı çağıranda kalır: `enforce` içinden `UnauthorizedError`
fırlatmak yeterli.

**Mevcut projelere etkisi:** Yok — imza genişlemesi geriye uyumlu.

---

## C-10 · 🆕 `guard()` izin anahtarı üzerinde generic değil

**Ağırlık:** Orta.

`guard(permissionKey: string)` — düz `string`. Tüketici tipli bir union istiyor
ki var olmayan bir izin anahtarı **derleme hatası** olsun.

**Kanıt** — laputa `guard()`'ı sarmalama gerekçelerinden biri:

> *"Anahtar tipli. Parametre `PermissionKey` union'ıdır, `string` değil → var
> olmayan bir yetki anahtarı derleme hatasıdır."*

**Tutarsızlık:** Core bu deseni **zaten biliyor ve başka yerde uyguluyor** —
`createResponder<Key extends string = string>()` mesaj anahtarları için tam
olarak bunu yapıyor, hatta JSDoc'unda *"aynı `*.permissions.ts` typo-güvenliği
felsefesi"* diye `permissions`a atıf var. `guard` bu felsefeyi izlemiyor.

**Önerilen düzeltme:**

```ts
export function guard<Key extends string = string>(permissionKey: Key): BaseGuardChain;
// veya fabrika formunda: createRbac<PermissionKey>({...}).guard(...)
```

**Mevcut projelere etkisi:** Yok — `= string` varsayılanı mevcut çağrıları korur.

---

## C-11 · 🆕 Bileşik sonuç: core'un `guard()`'ı tüketicide ölü kod

**Bu ayrı bir hata değil, `C-5` + `C-9` + `C-10`'un toplamının sonucu** — ve
kataloğun en önemli tek gözlemi.

`guard()` core'un en merkezî primitifi. laputa-backend onu **hiç kullanmıyor**:

```
$ grep -rn "hono-core/rbac" laputa-backend/src
attachAuthz · auditTrail · requirePermission · setGuardAuditSink
configureRbac · AuthzContext · RbacVariables
                                        ← guard YOK
```

Proje `shared/rbac/guard.ts`'de zinciri **elle** yeniden kurmuş; core'dan
yalnızca zincirin parçalarını alıyor. Üç gerekçesi de yukarıdaki üç bulgu:

| Gerekçe | Bulgu |
|---|---|
| auth adımı değiştirilemiyor (çerez) | `C-5` / `T-3` |
| oturum kontrolü zincire sokulamıyor | `C-9` |
| izin anahtarı tipli değil | `C-10` |

**Doğru okuma:** Core'un *parçaları* (`attachAuthz`, `requirePermission`,
`auditTrail`) sağlam ve kullanılıyor — sorun **kompozisyonun sabit olması**.
`guard()` bir fonksiyon değil, dondurulmuş bir karar.

**Önerilen yön:** `guard()`'ı kaldırma; **kompozisyonu açık hale getir.**

```ts
createRbac<PermissionKey>({ ... }).guard(key, { steps: [...] })
// veya: parçalar zaten export ediliyor → guard() yalnızca yaygın hâlin kısayolu
```

Ölçüt: laputa'nın `shared/rbac/guard.ts`'i core'un fabrikasıyla **5 satıra
inebiliyor mu?** İnemiyorsa tasarım henüz doğru değil.

---

# T — Tüketici raporu (laputa-backend'de DOĞRULANDI)

> Bu bulgular önce ajan raporundan geldi, sonra `laputa-backend` kaynağında
> tek tek doğrulandı. Her birinin altında dosya/satır kanıtı var.
> **Hâlâ core tarafında başarısız bir testle gösterilmeleri gerekiyor** —
> doğrulama "sorun var" der, test "core'un neyi yapmadığı"nı sabitler.

## T-1 · İzin kataloğu ↔ DB senkronu (`db:bootstrap`) yok · ✅ DOĞRULANDI

**Kanıt:** `laputa-backend/src/db/bootstrap.ts` — **231 satır**, `bun run
db:bootstrap` script'i olarak paketlenmiş. Tek kaynak
`shared/rbac/permissions.ts` + `role-bundles.ts`; `db:seed` de onu çağırıyor.
Rapor edilen kuralların hepsi kodda mevcut: transaction, `added/updated`
raporlaması (`BootstrapReport`), rol-izin bağı kaldırma, cache invalidasyonu
(`invalidateUsersPermissions`).

**Rapor:** Core RBAC taşıyor — yetkiler veritabanında, katalog kodda — ama
ikisini güvenle senkronlayan mekanizma yok. Yaşanan: `audit.view` eklendi,
testler geçti, dev DB'de yetki yoktu, owner 403 aldı; üretimde tek çare veriyi
silen bir seed oldu.

**Neden ciddiye alınmalı:** Aynı duvara **iki proje bağımsız olarak** çarpmış
(uniclub kendi kopya kataloğunu tutan, zamanla sapan bir senkron script'i
yazmış). İki bağımsız tüketicide çıkan aynı boşluk, yapısal bir eksiğin en
güçlü göstergesidir.

**Taşınacak olan kod değil, kurallar:**
- idempotent olmak
- açıklama değişince **güncellemek** (`onConflictDoNothing` tuzağı)
- paketten çıkarılan yetkinin bağını kaldırmak
- authz cache'ini düşürmek
- ne yaptığını raporlamak
- **kendi katalog kopyasını asla tutmamak** (uniclub'ın hatası)

**Doğrulama adımı:** core'da bir `PermissionCatalog` → `PermissionStore` portu
tasarla, bootstrap'ı bu port üstünde yaz, bellek adaptörüyle test et. DB'ye
bağlanmamalı — core'un mevcut port/adaptör felsefesi bunu zaten sağlıyor.

**Etki:** Eklemeli, kırıcı değil (yeni modül).

## T-2 · Çalışma anında şema seçiminde ham `ZodError` → 500 · ✅ DOĞRULANDI

**Kanıt:** `laputa-backend/src/shared/utils/zod-error.util.ts` —
`badRequestFromZod()` + `formatZodValidationDetails()`, ~170 satır TR/EN issue
şablonlama (`too_small`, `invalid_format`, `origin` bazlı dallanma).
Üç serviste kullanılıyor: `content.admin.service.ts` (3 çağrı),
`settings.service.ts` (1). `settings.service.ts:82`'deki yorum sorunu birebir
anlatıyor: *"`parse` değil `safeParse`: ham `ZodError` fırlatmak istemciye 500…"*

**Rapor:** Şema çalışma anında seçildiğinde doğrulama servise iniyor,
`createValidator`'ın kapsamı dışında kalıyor ve ham `ZodError` istemciye 500
olarak dönüyor. Ayrıca mesajların yerelleştirilebilir olması gerekiyor; aksi
halde kullanıcı `"Too small: expected string to have >=1 characters"` görüyor.

**Yorum:** Bu inandırıcı. `createValidator` bir Hono middleware fabrikası;
HTTP kenarının dışında çağrılamıyor. Eksik olan, kenar-bağımsız bir köprü:
`ZodError → ValidationError`. Core sabit metin **vermemeli**, mesaj eşleyici
dikişi vermeli — `createValidator`'ın `formatError` sözleşmesi zaten bu, tek
yapılması gereken onu middleware'den ayırmak.

**Doğrulama adımı:** `badRequestFromZod(error, t)` çıkar, `createValidator` de
onu kullansın. Aynı `formatError` iki yerden çağrılabilir hale gelir.

**Etki:** Eklemeli. `C-1` ile aynı dosyaya dokunuyor — birlikte yapılmalı.

## T-3 · `authMiddleware` yalnızca Bearer okuyor · ✅ DOĞRULANDI

**Kanıt:** `laputa-backend/src/shared/auth/auth.middleware.ts` — core'un
`authMiddleware`'inin **tam bir kopyası**, tek farkı token kaynağı:
`readSessionCookie(c) ?? readBearer(c)`. Dosyanın kendi yorumu gerekçeyi
yazıyor: *"core'unki yalnızca Bearer okur ve core AYRI BİR DEPODUR — çerez
desteği için onu değiştirmek yerine proje kendi dikişini kurar."*
Yanında `session-cookie.ts` (httpOnly + üretimde Secure + SameSite=Lax +
çıkış temizliği) — ajanın "tamamen jenerik" dediği dosya, gerçekten öyle.

**Rapor:** Panel oturumu çerezle taşınıyor; tüketici kendi middleware'ini
yazmak zorunda kalmış.

**Yorum:** Core tarafından doğrulanabilir — `authMiddleware` gerçekten yalnızca
`Authorization: Bearer` okuyor. Doğru çözüm mekanizmayı değiştirmek değil,
**token çıkarıcıyı enjekte edilebilir** yapmak; varsayılan Bearer kalır.

Bu `C-5`'in bir alt kümesi: `createAuth({ verify, extract })` fabrikası bunu
zaten karşılar. **Ayrı iş olarak planlanmamalı**, `C-5` ile birlikte çözülmeli.

**Etki:** Eklemeli (varsayılan değişmiyor).

## T-4 · `BaseRepository` bileşik anahtarı karşılamıyor · ✅ DOĞRULANDI — **rapordan büyük**

**Ağırlık YÜKSELTİLDİ.** Ajan "ayarlar ve çeviri tabloları" demiş; ölçünce
sorunun boyutu daha büyük çıktı.

**Kanıt — laputa'da bileşik birincil anahtarlı 11 tablo:**

```
schema.content.ts   8 tablo  mediaTranslations, serviceTranslations,
                             workTranslations, reelTranslations,
                             partnerTranslations, testimonialTranslations,
                             teamMemberTranslations   → (…Id, locale)
                             siteSettings             → (key, locale)
schema.platform.ts  3 tablo  rolePermissions  → (roleId, permissionId)
                             userRoles        → (userId, roleId)
                             userPermissions  → (userId, permissionId)
```

Yani **RBAC'ın kendi join tabloları bile** `BaseRepository` kullanamıyor —
core'un en çok kullanılan modülü, core'un veri katmanına sığmıyor. Bu, "her
i18n'li projede çıkar" tahminimden güçlü: **her RBAC'lı projede de çıkıyor.**

`settings.repository.ts` engeli isim isim yazmış:

> *"⚠ `BaseRepository` BURADA KULLANILAMAZ — bir istisna değil, teknik bir
> engel: `BaseRepository<TTable extends WithId>` tablonun tekil bir `id`
> kolonu olmasını ŞART koşar. Yapay bir `id` kolonu eklemek yalnızca çekirdeği
> memnun etmek için tabloyu bozmak olurdu."*

**Kullanım tablosu** — 7 repository core'u kullanıyor, 5'i kullanmıyor:

| `BaseRepository` kullanan | Kullanmayan | Sebep |
|---|---|---|
| analytics, audit, auth, inquiries, projects, revisions, users | `settings.repository` | **bileşik anahtar** (`T-4`) |
| | `rbac.repository` | **bileşik anahtar** (join tabloları) |
| | `content.repository` | dinamik tablo seçimi |
| | `analytics.query`, `analytics.rollup`, `media` | özel/analitik sorgular — **beklenen**, sorun değil |

**İki senaryoyu ayır — aynı ağırlıkta değiller:**

> ⚠️ **Sonradan düzeltme (v0.4.0 sonrası, laputa kaynağı yeniden okundu):** 11
> tablo bileşik anahtarlı, ama hepsi `CompositeKeyRepository` adayı DEĞİL. Çeviri
> tabloları kayıt defteri deseniyle (çalışma anında tablo seçimi) yazılıyor —
> bilinçli olarak kapsam dışı. RBAC bağ tabloları ise ilişkisel sorgularla
> okunuyor. Gerçek adaylar: `settings.repository` (net) ve
> `analytics.rollup.repository` (iyi uyum). Bulgunun yönü doğruydu, **büyüklüğü
> abartılmıştı**.

- **Bileşik anahtar → net kazanç, yapılmalı.** 11 tablo, iki bağımsız alan
  (i18n + RBAC). `WithId` kısıtı bugün `id: PgColumn` zorunlu tutuyor.
- **Çalışma anında tablo seçimi → yapılmamalı.** Ajanın kendi önerisi isabetli:
  *"desteklemeye çalışma, ama nasıl yazılacağını belgele."* `content.repository`'yi
  okuyunca bu doğrulanıyor — elle JOIN yazmasının gerekçesi bilinçli
  (payload'a hangi kolonun çıktığını dosyada görünür kılmak), core'un
  düzeltebileceği bir eksik değil.

**Etki:** Eklemeli. `BaseRepository`'yi `IdOf` etrafında karmaşıklaştırmak
yerine ayrı bir `CompositeKeyRepository<TTable, TKey>` düşünülmeli — `findByKey`,
`upsert`, `deleteByKey` üzerinden. Upsert bileşik anahtarlı tabloların asıl
ihtiyacı ve `BaseRepository`'de hiç yok.

## T-5 · Denetim izinin "GET atla" politikası core'a gömülü · ✅ DOĞRULANDI

**Kanıt:** `laputa-backend/src/features/inquiries/inquiries.routes.ts:53-71` —
CSV export ucunda elle `auditService.record()` çağrısı, `try/catch` ile
sarılmış. Yorumu birebir: *"`guard()`'ın auditTrail kancası GET isteklerini
bilinçli olarak atlar (gürültü önleme). Kişisel veri döken bu uç için kayıt
burada düşülür."* Yani tüketici core'un sink mekanizmasını **atlayıp** kendi
servisini çağırmak zorunda kalmış — üstelik core'un sink'te zaten yaptığı hata
yutmayı da elle tekrarlamış.

**Rapor:** Kişisel veri döken bir export ucu izsiz kalmış, elle kayıt düşmek
zorunda kalınmış.

**Yorum:** Doğrulanabilir — `audit-hook.ts`'te `SKIP_METHODS` sabit. Bu bir
**politika** ve core'un kendi felsefesine göre projede olmalı. Varsayılan
bugünkü gibi kalmalı (GET'ler gürültü), ama seçilebilir olmalı.

**Etki:** Eklemeli — `setGuardAuditSink`'e/`auditTrail`'e bir `shouldAudit(c)`
predikatı. Varsayılan değişmediği için kırıcı değil.

## T-6 · Core CI'ında tüketici duman testi yok · ✅ ÇÖZÜLDÜ

> **Kapatıldı.** İki katman kuruldu:
> - **Katman A** — `tests/dependency-contract.test.ts`: her alt yolun peer
>   sözleşmesi, kurulum yapmadan, `bun test` içinde doğrulanır. İlk koşuda
>   `C-1`'i yakaladı.
> - **Katman B** — `bun run check:consumer <yol>`: gerçek bir tüketicinin
>   import yüzeyini salt-okunur doğrular (isimlere `tsc` karar verir, tipler
>   dahil). Üç kırılma sınıfı deneyle doğrulandı.
>
> Ayrıntı ve tasarım gerekçeleri: [`02-yol-haritasi.md`](02-yol-haritasi.md).

**Rapor:** Core'da bir değişiklik yapıldığında 60 dosyanın etkilenip
etkilenmediği ancak elle fark ediliyor.

**Yorum:** Bu kataloğun **en yüksek getirili maddesiydi** ve tek başına `C-1`'i
de yakaladı — çünkü core'un kendi testleri `/http`'i her zaman peer kurulu
ortamda import ediyor, tüketici ortamını hiç simüle etmiyordu.

## T-7 · Tüketicilerde core sürümü kilitli değil · ✅ ZATEN ÇÖZÜLMÜŞ — aksiyon yok

**Kanıt:** `laputa-backend/package.json`:

```json
"@mustafakurtt/hono-core": "github:mustafakurtt/hono-core#v0.1.0"
```

Etikete kilitli. Ajanın endişesi yerindeydi ama bu projede karşılığı yok.
Kalan iş yalnızca **kuralı yazılı hale getirmek** (bkz. uyumluluk politikası,
madde 5) ki yeni tüketiciler `main`'e bağlanmasın.

## T-8 · uniclub-backend ayrışmış vendor kopya taşıyor

**Rapor:** uniclub hâlâ core'un kendi kopyasını taşıyor; ayrışma büyümüş
(çerez auth, denetim izi kancası, RBAC sağlama).

**Yorum:** Bu en pahalı borç, çünkü **bilgi akışını kesiyor**: birinde
öğrenilen diğerine taşınmıyor. Üç seçenek var ve karar senin:

| Seçenek | Maliyet | Sonuç |
|---|---|---|
| uniclub'ı pakete taşı | Yüksek, tek seferlik | Tek gerçek çözüm |
| Çatalı kabul et — "paket yeni projeler için" | Düşük | Dürüst, yönetilebilir |
| Bugünkü belirsizlikte kal | Sıfır (görünürde) | **En kötüsü** |

Üçüncüsü en kötüsü çünkü ikisini "aynı" sanıp birinde öğrenileni diğerine
taşımayı unutursun — ki `T-1`'de tam olarak bu olmuş (uniclub senkron sorununu
farklı ve daha kötü çözmüş, o bilgi core'a akmamış).

**Karar verilmeli, ertelenmemeli.** İkinci seçenek bile üçüncüsünden iyidir.

---

## Bulgular arası bağlantılar

Aynı işe dokunan maddeler — birlikte planlanmalı:

- **`C-5` + `C-9` + `C-10` + `T-3` = `C-11`.** Dördü tek bir işin parçaları:
  RBAC/auth kompozisyonunu açmak. **Ayrı ayrı planlanmamalı** — tek bir
  fabrika dönüşümü dördünü birden kapatır.
- **`C-1` + `T-2`** → ikisi de `validation.ts`'i bölüyor. Ayrıca laputa'nın
  `createValidator`'ı hiç kullanmaması da aynı kökten (biçimlendirme
  middleware'e yapışık).
- **`T-1` + `C-9`** → ikisi de RBAC'ın "veri tarafı"; bootstrap yetkileri
  yazar, `enforce` onları uygular. Aynı modülün iki ucu.
- **`T-6` + `C-1`** → duman testi olsaydı `C-1` üretime hiç çıkmazdı. `T-6`
  bir bulgu değil, **bulgu üreten mekanizma**.
- **`C-7` + `T-7`** → sürüm kilitleme. `T-7` tüketicide zaten çözülmüş;
  geriye yalnızca `C-7` (peer aralığı) kaldı.

## Doğrulamanın kendisinden çıkan iki ders

**1. Doğrulanmamış bulgu implemente edilmemeli.** `C-3` bunun canlı örneği:
core'a bir `requestId` middleware'i ekleyecektik, oysa Hono'nun `requestId()`'si
zaten aynı anahtarı set ediyor ve daha sağlam. Doğrulama bir modülü **eklemekten
kurtardı**.

**2. Bir bulgunun ağırlığı tüketiciye bakmadan bilinemez.** İki yönde de kaydı:

| Bulgu | Önce | Sonra | Sebep |
|---|---|---|---|
| `C-1` | "tek kırıcı madde, dikkat" | etkisi **sıfır** | tüketici `createValidator` kullanmıyor |
| `C-3` | "eksik mekanizma, orta" | **doküman satırı** | Hono zaten sağlıyor |
| `T-4` | "iki tablo, orta" | 11 tablo bileşik anahtarlı, **2'si gerçek aday** | Çoğu kayıt defteri/ilişkisel desende — kapsam dışı |
| `T-7` | "yüksek risk" | **zaten çözülmüş** | `#v0.1.0` kilitli |
