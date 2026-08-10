# Yayınlanmamış (v0.2.0 hedefi)

**Tek cümlelik özet:** Doğrulama katmanı ikiye ayrıldı — kenar-bağımsız zod
köprüsü `/http`'e, Hono middleware'i `/http/validation`'a. Yanında dört küçük
düzeltme.

**Kırıcı mı:** Evet — tek bir import yolu değişikliği.

---

## Etki

| Tüketici | Etkilenir mi | Gereken iş |
|---|---|---|
| laputa-backend | Hayır | Yok. `check:consumer` ile doğrulandı. |
| uniclub-backend | Hayır | Yok — vendor kopya taşıyor, pakete bağlı değil. |
| bun-hono-starter | Bilinmiyor | `createValidator` kullanıyorsa aşağıdaki tek satır. |

Kaynağında `createValidator` **geçmiyorsa** bu sürüm seni etkilemiyor.

---

## Yapılacaklar

`createValidator` / `CreateValidatorOptions` kullanmıyorsan: **hiçbir şey.**

Kullanıyorsan yalnızca import yolu değişir (genelde tek dosya):

```diff
- import { createValidator } from "@mustafakurtt/hono-core/http";
+ import { createValidator } from "@mustafakurtt/hono-core/http/validation";
```

Aynı dosyadan aldığın diğer isimler (`createErrorHandler`, `NotFoundError`…)
`/http`'te kalır — iki ayrı import olur.

---

## Değişiklikler

### Kırıcı

- `createValidator` ve `CreateValidatorOptions` → `/http/validation`. `/http`'i
  yalnızca hata sözleşmesi için içe aktaran projeler artık
  `@hono/zod-validator` kurmak zorunda değil. (`C-1`)

### Eklendi

- **`createZodErrorMapper`** (`/http`) — `ZodError` → `ValidationError` köprüsü.
  HTTP kenarından bağımsızdır: `Context` almaz, `@hono/zod-validator`
  gerektirmez. Şema çalışma anında seçildiğinde (`safeParse` servis katmanında)
  artık ham `ZodError` 500'e düşmüyor; rotadakiyle **aynı 400 zarfı** üretiliyor.
  `createValidator` de bu köprüyü kullanır, kural tek yerde durur. (`T-2`)
- `ProcessSignal` tipi (`/http`).

### Düzeltildi

- `generatePassword` artık her karakter sınıfından birini gerçekten garanti
  ediyor. Alfabe indeksleri kaymış olduğu için "büyük harf" yuvası bazen küçük
  harf, "küçük harf" yuvası bazen rakam üretiyordu (~20.000'de 1 — nadir olduğu
  için elle fark edilmezdi). (`C-4`)
- `LocalDiskStorage` iç içe anahtarları destekliyor (`2026/08/a.png`); önceden
  `ENOENT` veriyordu. (`C-6`)
- Core artık `NodeJS` ambient namespace'ine bağlı değil. (`C-2`)

### Değişti

- `drizzle-orm` peer aralığına üst sınır: `>=1.0.0-rc.4 <2`. (`C-7`)
- README: `@types/bun`'ın **zorunlu** olduğu yazıldı. Core kaynak olarak
  dağıtıldığı için tüketicinin `tsc`'si core'u da derler. (`C-2`)

### İç (tüketiciyi etkilemez)

- Alt yolların peer sözleşmesi artık test ediliyor
  (`tests/dependency-contract.test.ts`); bir modül bildirilmemiş bir peer'a
  uzanırsa CI kırılır.
- `bun run check:consumer <yol>` — bir tüketicinin import yüzeyini salt-okunur
  doğrular.
- `shutdown`, `config`, `LocalDiskStorage`, şifre invaryantları ve zod köprüsü
  için testler eklendi (90 → 144).

---

## Doğrulama

```sh
bun run typecheck
bun test
```

`createValidator` kullanıyorduysan: doğrulama hataları hâlâ aynı zarfla
dönmeli (`success: false`, `code`, `details`). Taşınan yalnızca import yolu —
davranış ve imza değişmedi.

---

## Dikkat

- **`@hono/zod-validator`'ı kaldırma** — `/http/validation` kullanmaya devam
  ediyorsan hâlâ gerekli. Bu sürüm onu opsiyonel *yapmadı*, gerektirmeyen
  modülleri ondan **kurtardı**.
- Servis katmanında `parse` değil `safeParse` + `createZodErrorMapper` kullan;
  ham `ZodError` fırlatmak 500'e düşer.
- Sürümü etikete kilitle (`#v0.2.0`), `main`'e bağlanma.
- Henüz **etiketlenmedi**; `package.json` hâlâ `0.1.0`.

---

## Bağlantılar

Bulgular: [`../01-bulgular.md`](../01-bulgular.md) — `C-1`, `C-2`, `C-4`, `C-6`,
`C-7`, `T-2`, `T-6`
