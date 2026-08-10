# laputa-backend geçiş rehberi — core v0.1.0 → v0.4.0

Bu belge **laputa-backend'e özeldir**. Sürüm notları (`v0.2.0.md`, `v0.3.0.md`,
`v0.4.0.md`) core'un ne değiştiğini anlatır; bu belge *laputa'da hangi dosyanın
ne olacağını* söyler ve laputa'nın kaynağı okunarak yazılmıştır.

---

## Önce en önemlisi: zorunlu iş YOK

```sh
# tek gereken değişiklik
- "@mustafakurtt/hono-core": "github:mustafakurtt/hono-core#v0.1.0"
+ "@mustafakurtt/hono-core": "github:mustafakurtt/hono-core#v0.4.0"
```

Üç sürümde tek kırıcı değişiklik vardı (`createValidator` alt yol değişikliği) ve
laputa `createValidator` kullanmıyor. Core tarafında `bun run check:consumer` ile
doğrulandı: laputa'nın **74 import ifadesinin tamamı** v0.4.0'da geçerli.

Yani sürümü yükselt, `typecheck` + `test` koştur, bitti. Aşağıdaki her şey
**isteğe bağlı kazanç**.

---

## 1. Artık gerek olmayanlar (silinebilir)

### `src/shared/auth/auth.middleware.ts` — tamamen

Bu dosya core'un `authMiddleware`'inin kopyasıydı; tek farkı token'ı önce
çerezden, sonra Bearer'dan okumasıydı. Core artık token kaynağını enjekte
edilebilir yapıyor:

```ts
import { createAuth, cookieToken, bearerToken, firstToken } from "@mustafakurtt/hono-core/auth";

const auth = createAuth({
  verify: verifyToken,
  extract: firstToken(cookieToken(SESSION_COOKIE), bearerToken),
});
```

`firstToken` sırayı korur — dosyanın yorumundaki "çerez önce" gerekçesi aynen
geçerli ve core'da da aynı gerekçeyle belgelenmiş.

`session-cookie.ts` **KALIR**: çerez yazma tarafı (secure/sameSite/ömür) bilinçli
olarak core'a alınmadı, o kararlar projeye ait.

### `inquiries.routes.ts` içindeki elle denetim kaydı

CSV export ucundaki `auditService.record(...)` bloğu (`try/catch` dahil) artık
gereksiz. `guard()`'ın GET atlaması bir politikaydı ve core'a gömülüydü; şimdi
dışarıdan veriliyor:

```ts
createRbac({
  ...,
  shouldAudit: (c) => isMutation(c) || c.req.path.endsWith("/export"),
});
```

Core sink hatasını zaten yutuyor — `try/catch`'i tekrarlamaya gerek yok.

---

## 2. Küçülecekler

### `src/shared/rbac/guard.ts` — ~40 satır → ~11

Üç sarmalama gerekçesinin üçü de core'da karşılandı: kimlik adımı enjekte
edilebilir, ek adım zincire girebilir, izin anahtarı tipli olabilir.

```ts
export const { guard } = createRbac<PermissionKey>({
  auth: auth.middleware,
  getSubjectId: (user) => user.userId,
  resolveAuthz: rbacCache.resolveAuthz,
  enforce: enforceAccountStatus,
  steps: [requireCurrentSession],
  audit: auditSink,
});
```

`requireCurrentSession` **olduğu gibi kalır** — `steps` içine girer ve
`attachAuthz`tan sonra, yetki kontrolünden önce çalışır; bugünkü sırayla aynı.

> Bu dönüşüm core tarafında derlenerek doğrulandı: `c.req.param()` tipleri
> korunuyor ve var olmayan bir izin anahtarı derleme hatası veriyor.

### `src/features/settings/settings.repository.ts`

Dosyanın kendi yorumu engeli anlatıyordu: `BaseRepository` tekil `id` şart
koşuyor, `site_settings` anahtarı `(key, locale)`. Artık karşılığı var:

```ts
const settings = new CompositeKeyRepository(db, siteSettings, {
  keyColumns: ["key", "locale"],
});
```

`findByKey` / `listByLocale` (→ `findMany({ locale })`) / upsert bu sınıfa
devredilebilir.

### `src/db/bootstrap.ts` — 231 satır

Kurallar (idempotentlik, açıklama güncelleme, paketten çıkan bağı kaldırma,
raporlama) artık core'da ve test edilmiş durumda. laputa'nın yazacağı şey
bir **Drizzle `PermissionStore` adaptörü** (~40 satır) olur:

```ts
const report = await bootstrapPermissions(
  { permissions: PERMISSION_CATALOG, roles: ROLE_BUNDLES },
  drizzlePermissionStore
);
if (totalChanges(report) > 0) await invalidateUsersPermissions(...);
```

Transaction, cache invalidasyonu ve konsol raporlaması **laputa'da kalır** —
core bunları bilinçli olarak çağırana bırakıyor. Kazanç satır sayısından çok
kuralların paylaşılması ve test edilmiş olması.

---

## 3. Değerlendirilecekler (topluca uygulama)

### `analytics.rollup.repository.ts` — iyi uyum

`analyticsDaily` altı kolonlu bileşik anahtara sahip ve elle `onConflictDoUpdate`
yazıyor. `CompositeKeyRepository.upsertMany` bunu karşılar.

⚠️ **Önce kontrol et:** core'un `upsert`'ü tabloda `updatedAt` kolonu varsa onu
otomatik tazeler. `analyticsDaily`'de böyle bir kolon varsa ve tazelenmesi
istenmiyorsa elle yazım korunmalı.

### `zod-error.util.ts` / `validate.ts`

`badRequestFromZod` core'un `createZodErrorMapper`'ı üzerine kurulabilir; TR/EN
issue şablonları (`localizeZodIssue*`) **projede kalır** — onlar politika.
Kazanç: rota ve servis yolunun aynı köprüyü kullandığının garanti altına
alınması.

### `auth.repository.ts` — `userRoles` bağlama

`onConflictDoNothing` ile yazılmış. `CompositeKeyRepository.upsert` aynı davranışı
verir (güncellenecek kolon olmadığında kendiliğinden `DoNothing`'e düşer), ama
kazanç marjinal — dokunmamak da savunulabilir.

---

## 4. Bunlara DOKUNMA

Bu bölüm bilinçlidir; toplu "core'a geçir" refactor'u burada durmalı.

- **`content.admin.repository.ts`'teki çeviri upsert'i.** Tablo çalışma anında
  kayıt defterinden seçiliyor; `CompositeKeyRepository` kurulurken somut tablo
  ister. Bu desen core'un kapsamı DIŞINDA bırakıldı — elle yazım doğru çözüm.
- **`content.repository.ts`'teki elle JOIN'ler.** Gerekçesi bilinçli: halka açık
  payload'a hangi kolonun çıktığı dosyada görünür olsun diye. Core'un
  düzeltebileceği bir eksik değil.
- **`rbac.repository.ts`.** Bileşik anahtar yüzünden değil, ilişkisel sorgu
  olduğu için `BaseRepository` kullanmıyor — doğru olan da bu.
- **`session-cookie.ts`**, **i18n katalogları**, **izin/rol katalogları**,
  **medya kabul politikası**: hepsi ürün kararı, core'a girmez.
- **Süreç-geneli kısayollar** (`configureRbac`, `setTokenVerifier`) fabrikaya
  geçildiğinde `index.ts`ten kaldırılmalı — ikisini birden kullanma.

---

## 5. Uygulama sırası

Her adımdan sonra `bun run typecheck && bun test` koş. Adımlar bağımsızdır;
biri sorun çıkarırsa geri alıp diğerlerine devam edilebilir.

1. **Sürümü yükselt** (`#v0.4.0`) → typecheck + test. Buradan sonrası isteğe bağlı.
2. `guard.ts` + `auth.middleware.ts` → `createAuth` + `createRbac`. En büyük kazanç,
   en çok dikkat isteyen adım. `index.ts`teki `configureRbac`/`setTokenVerifier`
   çağrıları kaldırılır.
3. `shouldAudit` → `inquiries.routes.ts`teki elle kaydı sil.
4. `settings.repository.ts` → `CompositeKeyRepository`.
5. `bootstrap.ts` → `bootstrapPermissions` + Drizzle adaptörü. **`db:bootstrap`'ı
   dev veritabanında koşturup raporun beklenenle aynı olduğunu doğrula.**
6. Kalanlar (analytics rollup, zod köprüsü) — değerlendir, zorunlu değil.

---

## 6. Doğrulama

Her adımdan sonra laputa'da:

```sh
bun run typecheck
bun test
```

Core tarafında (bizde), laputa'nın import yüzeyinin hâlâ uyumlu olduğu:

```sh
bun run check:consumer <laputa-yolu>
```

`guard.ts` dönüşümünden sonra özellikle şunları elle doğrula:

- Çerezle giriş → korumalı uca erişim → 200
- Bearer ile aynı akış → 200
- `tokenVersion` artırıldıktan sonra eski token → **401** (403 değil)
- İzni olmayan kullanıcı → **403**, ve denetim izine kayıt düşmüş olmalı
- CSV export ucu → denetim izine kayıt düşmüş olmalı

---

## Ajana verirken

Bu belgeyi olduğu gibi yapıştır ve şunu ekle:

```text
Bu, kullandığın @mustafakurtt/hono-core paketinin v0.1.0 → v0.4.0 geçiş
rehberi. Sırasıyla:

1. Bölüm 5'teki sırayı izle. ADIMLARI ATLAMA ve BİRLEŞTİRME.
2. Her adımdan sonra typecheck + test koştur; kırmızıysa DUR ve raporla.
3. Bölüm 4'teki "dokunma" listesine uy — oradaki dosyalar bilinçli olarak
   böyle yazıldı, core'a taşınmaları bir iyileştirme DEĞİL.
4. Adım 1 dışındaki her şey isteğe bağlıdır. Emin olmadığın bir yerde tahminle
   ilerleme, sor.
5. Bitirdiğinde hangi adımları yaptığını ve hangi dosyaların silindiğini
   raporla.

--- REHBER ---
<bu belgeyi buraya yapıştır>
```
