# hono-core

Bun + Hono projeleri için taşınabilir backend çekirdeği. RBAC, i18n, cache, HTTP hata
sözleşmesi, Drizzle temel repository'si, loglama, mail, Redis, depolama, metrikler ve
hız sınırlama — hepsi **mekanizma** olarak; hiçbiri projeye bağlı değil.

Bu paket bir framework değil, bir **çekirdek**tir: rota, tablo veya iş kuralı içermez.
Onlar başlangıç şablonunun (`bun-hono-starter`) işidir.

## Temel ilke: mekanizma core'da, politika projede

Core `env` okumaz, proje alan adlarını (`userId`, `tenantId`) ve rol adlarını
(`super_admin`) **isim olarak bilmez**, dil bilmez. Projeye özgü her şey bir
**fabrika** veya **dikiş** üzerinden enjekte edilir:

```ts
// Core mekanizmayı tanımlar; proje kurar.
createLogger({ level, transports })            // logger örneği
createErrorHandler({ logger, translate })      // merkezi hata çıkışı
createRateLimiter({ store, keyFn, limit })     // hız sınırlayıcı
createAuth({ verify, extract })                // kimlik doğrulama
createRbac({ auth, resolveAuthz, steps })      // yetki motoru
createZodErrorMapper({ format })               // doğrulama → 400 köprüsü
```

Fabrikalar süreç durumu tutmaz: aynı süreçte birden çok yapılandırma
(panel + genel API, ya da izole testler) mümkündür. Tek uygulamalı projeler
için süreç-geneli kısayollar da vardır (`configureRbac`, `setTokenVerifier`) —
ikisi de aynı fabrikanın üzerine kuruludur.

Pratik sonucu: core'u başka bir projeye taşıdığında hiçbir satırını
düzenlemezsin — sadece farklı şeyler enjekte edersin.

## Kurulum

```sh
bun add github:mustafakurtt/hono-core#v0.4.0
```

Peer bağımlılıklar isteğe bağlıdır: yalnızca kullandığın modülünkini kurarsın.
`hono`, `zod` ve `pino` fiilen her zaman gerekir; `drizzle-orm` (db), `ioredis`
(redis/cache/ratelimit adaptörleri), `nodemailer` (mail), `prom-client` (metrics),
`web-push` (notifications) ve `@hono/zod-validator` (http/validation) opsiyoneldir.

Kaynak olarak dağıtılır (build adımı yok) — Bun TypeScript'i doğrudan çalıştırır.
Bunun bir bedeli var: **tüketicinin `tsc`'si core'un kaynağını da derler**, bu
yüzden `@types/bun` kurulu olmalıdır (`skipLibCheck` işe yaramaz — bunlar `.d.ts`
değil `.ts`).

```sh
bun add -d @types/bun
```

## Modüller

Her modül kendi alt yolundan import edilir; kök barrel bilinçli olarak **yoktur**
(modüller arası isim çakışmasını ve kullanılmayan peer'ların yüklenmesini önler).

Aşağıdaki "Peer" sütunu bir vaat değil, **test edilen bir sözleşmedir**: her alt
yolun import grafiği `tests/dependency-contract.test.ts` tarafından bu tabloya
karşı doğrulanır. Bir modül bildirilmemiş bir peer'a uzanırsa test kırılır.

| Modül | Ne yapar | Peer |
|---|---|---|
| `/auth` | `createAuth()` fabrikası, token kaynakları (Bearer/çerez), `createJwt`, şifre hash'leme | hono |
| `/rbac` | `createRbac()` fabrikası, `guard()` zinciri, izin & rol kontrolü, tenant kapsamı, denetim kancası, izin kataloğu senkronu | hono |
| `/http` | `HttpError` ailesi, merkezi hata yakalayıcı, yanıt zarfı, istek logu, düzgün kapanma | hono |
| `/http/validation` | `createValidator` — zod doğrulamasını tek hata çıkışına bağlar | hono, zod, @hono/zod-validator |
| `/i18n` | Sıfır-bağımlılıklı çevirmen, katalog parite kilidi, dil çözümleme | hono |
| `/cache` | `Cache` facade (read-through + single-flight + namespace), memory/redis/null adaptörleri | — |
| `/ratelimit` | Sabit pencere sınırlayıcı (fail-open), memory/redis adaptörleri | hono |
| `/db` | `BaseRepository` (CRUD, soft delete, keyset, transaction), `CompositeKeyRepository` (bileşik anahtar + upsert), ortak kolon setleri | drizzle-orm |
| `/storage` | Nesne depolama portu, disk/memory adaptörleri, MIME sniffing | — |
| `/logger` | pino fabrikası (çoklu hedef, redaction) | pino |
| `/config` | zod ile ortam değişkeni doğrulama, `envBoolean` | zod |
| `/redis` | ioredis istemci fabrikası | ioredis |
| `/mail` | nodemailer taşıma katmanı | nodemailer |
| `/metrics` | Prometheus metrikleri + `/metrics` rotası | prom-client |
| `/notifications` | Web Push (VAPID) göndericisi | web-push |

### Öne çıkan davranışlar

- **Hata sözleşmesi** — iş hataları status'unu kendi taşır (`new NotFoundError("x.notFound")`).
  Altyapı hataları asla sızmaz: jenerik 500'e düşer, sunucu tarafında `requestId` ile loglanır.
  Eski "düz `Error` = iş hatası" konvansiyonu enjekte edilen bir classifier ile desteklenir,
  böylece feature'lar tek tek göç edebilir.
- **i18n geri uyumu** — katalogda olmayan anahtar **aynen döner**. Anahtara göç etmemiş
  düz metinler bozulmaz.
- **Cache fail-open** — okuma hatası miss'e düşer, `getOrSet`'in iç yazımı yutulur; ama
  açık `delete` (invalidasyon) hatayı **yükseltir** — kaçırılan invalidasyon doğruluk hatasıdır.
- **Rate limit anahtarlaması** — `keyFn` zorunludur, IP varsayılanı **yoktur**: NAT arkasındaki
  bir kurumu tek kullanıcı yüzünden kilitlememek için doğru anahtar genelde korunan kaynağın
  kimliğidir (e-posta, userId).
- **Denetim izi** — mutasyonlar `guard()` üzerinden otomatik kaydedilir, **reddedilen (403)
  denemeler dahil**. Sink hatası isteği asla düşürmez.

## Hızlı başlangıç

```ts
import { Hono } from "hono";
import { createLogger } from "@mustafakurtt/hono-core/logger";
import { createAuth, bearerToken, cookieToken, firstToken } from "@mustafakurtt/hono-core/auth";
import { createRbac } from "@mustafakurtt/hono-core/rbac";
import { createErrorHandler, ForbiddenError } from "@mustafakurtt/hono-core/http";

// 1) Proje kendi claim şeklini declaration merging ile tanımlar.
//    Core hiçbir proje alanını ismen bilmez.
declare module "@mustafakurtt/hono-core/auth" {
  interface AuthClaims { userId: string; tokenVersion: number }
}

// 2) Proje kendi izin anahtarlarını tipler.
type PermissionKey = "post.view" | "post.manage";

const logger = createLogger({ level: "info" });

// 3) Fabrikaları kur — dikişler burada bağlanır.
const auth = createAuth({
  verify: verifyJwt,
  // Tarayıcı çerezi önce: elle Bearer gönderen eski bir istemci güncel
  // oturumun önüne geçmesin.
  extract: firstToken(cookieToken("session"), bearerToken),
});

const { guard } = createRbac<PermissionKey>({
  auth: auth.middleware,
  getSubjectId: (user) => user.userId,
  resolveAuthz: loadPermissionsFromDb,
  enforce: (authz, user) => {
    if (authz.status === "suspended") throw new ForbiddenError("rbac.accountSuspended");
  },
  steps: [requireCurrentSession],        // yetki kontrolünden önce ek politika
  audit: (c, key) => writeAuditRow(c, key),
});

// 4) Rotalar guard zincirini kullanır. Anahtar tipli: yazım hatası derleme hatası.
const app = new Hono();
app.onError(createErrorHandler({ logger, fallbackMessage: "server.unexpected" }));
app.post("/posts", ...guard("post.manage"), (c) => c.json({ ok: true }));
```

## Geliştirme

```sh
bun install
bun run typecheck     # tsc --noEmit (src + tests)
bun test              # 178 test, altyapı gerektirmez

# core/db testleri gerçek Postgres ister:
docker compose up -d
cp .env.example .env  # Bun .env'i otomatik yükler
bun test              # artık db testleri de koşar
```

`tsconfig` bilinçli olarak tüketici projelerden daha katıdır (`noUnusedLocals`,
`noImplicitReturns`) — kullanılmayan kod pakete sızmasın.

## Bilinen sınırlar

- **v0.x, API dondurulmadı.** Çekirdek iki üretim projesine karşı doğrulandı ve
  ikinci proje üzerinden gelen bulgular kapatıldı; yine de kırıcı değişiklik
  olabilir. Sürümü etikete kilitle (`#v0.4.0`), `main`'e bağlanma.
- `/db`, core'un **Drizzle + PostgreSQL'e özgü** tek parçasıdır. ORM-agnostik
  değildir, bilinçli olarak. `BaseRepository` tekil `id`, `CompositeKeyRepository`
  bileşik anahtar içindir; çalışma anında tablo seçen desenler ikisine de girmez,
  elle yazılır.
- `rbac/audit-hook.ts` kendi logger örneğini modül yüklenirken kurar (seviyesi
  yapılandırılamaz). Core'un tek enjekte-edilemeyen logger'ı; bilinçli bir ödün.
- **Süreç-geneli kısayollar** (`configureRbac`, `configureTenantScope`,
  `setTokenVerifier`) modül düzeyinde durum tutar. Tek uygulama örneği için
  doğrudur; aynı süreçte iki yapılandırma ya da izole testler gerekiyorsa
  fabrikaları kullan (`createAuth` / `createRbac`).
- Kaynak olarak dağıtılır: tüketicinin `tsc`'si core'u da derler, `@types/bun`
  şarttır (bkz. Kurulum).

## Lisans

MIT
