# Yayınlanmamış (v0.2.0 hedefi)

**Tek cümlelik özet:** Doğrulama katmanı `/http` barrel'ından ayrı bir alt yola
taşındı; böylece `/http`'i yalnızca hata sözleşmesi için kullanan projeler artık
`@hono/zod-validator` kurmak zorunda değil.

**Kırıcı mı:** Evet — tek bir import yolu değişikliği.

---

## Etki

| Tüketici | Etkilenir mi | Gereken iş |
|---|---|---|
| laputa-backend | **Hayır** | Yok. `createValidator` kullanılmıyor; kendi `shared/utils/validate.ts` dosyası var. `bun run check:consumer` ile doğrulandı: 74 import ifadesi, 38 benzersizi derlendi, uyumlu. |
| uniclub-backend | **Hayır** | Yok. Core'un vendor kopyasını taşıyor, pakete bağlı değil. |
| bun-hono-starter | **Bilinmiyor** | `createValidator`'ı `/http`'ten import ediyorsa aşağıdaki tek satırlık değişiklik gerekir. |

Genel kural: kaynağında `createValidator` **geçmiyorsa** bu sürüm seni
etkilemiyor.

---

## Yapılacaklar

`createValidator` veya `CreateValidatorOptions` kullanmıyorsan:
**hiçbir şey yapman gerekmiyor.**

Kullanıyorsan import yolunu değiştir (genelde tek dosya — validator bir kez
kurulur):

```diff
- import { createValidator } from "@mustafakurtt/hono-core/http";
+ import { createValidator } from "@mustafakurtt/hono-core/http/validation";
```

```diff
- import type { CreateValidatorOptions } from "@mustafakurtt/hono-core/http";
+ import type { CreateValidatorOptions } from "@mustafakurtt/hono-core/http/validation";
```

Aynı dosyada `/http`'ten başka isimler de alıyorsan onları **olduğu yerde
bırak** — yalnızca doğrulamayla ilgili iki isim taşındı:

```ts
// doğru sonuç — iki ayrı import
import { createErrorHandler, NotFoundError } from "@mustafakurtt/hono-core/http";
import { createValidator } from "@mustafakurtt/hono-core/http/validation";
```

---

## Değişiklikler

### Kırıcı

- **`createValidator` ve `CreateValidatorOptions`, `/http` barrel'ından
  çıkarıldı**; artık `@mustafakurtt/hono-core/http/validation` alt yolundan
  gelir. Gerekçe: `/http`'i içe aktaran herkes — sadece `HttpError` ailesi
  için bile olsa — opsiyonel olması gereken `@hono/zod-validator` peer'ını
  kurmak zorunda kalıyordu ve peer kurulu değilse **çalışma anında
  çöküyordu**. (`C-1`)

### Eklendi

- **`./http/validation` alt yolu.** Peer'ı: `hono`, `zod`,
  `@hono/zod-validator`.

### Düzeltildi

- **`/http` artık opsiyonel peer gerektirmiyor.** Yalnızca `hono`+`zod`+`pino`
  kurulu bir projede doğrulandı: önceden çöküyordu, şimdi 13 export ile
  yükleniyor.

### İç (tüketiciyi etkilemez)

- Alt yolların peer sözleşmesi artık **test edilen bir sözleşme**:
  `tests/dependency-contract.test.ts` her `exports` girişinin import grafiğini
  çıkarıp bildirilen peer listesine karşı doğruluyor. Bir modül bildirilmemiş
  bir peer'a uzanırsa CI kırılıyor — bu sınıf hata bir daha tüketiciye ulaşmaz.
- `bun run check:consumer <yol>` eklendi: bir tüketicinin import yüzeyini
  **salt-okunur** doğrular (o projeye yazmaz, kurulum yapmaz).

---

## Doğrulama

Tüketicide:

```sh
bun run typecheck     # temiz olmalı
bun test              # yeşil olmalı
```

`createValidator` kullanıyorduysan ayrıca doğrulanması gereken: doğrulama
hatalarının hâlâ aynı zarfla döndüğü (`success: false`, `code`, `details`).
Taşınan yalnızca import yolu; davranış ve imza **değişmedi**.

Core tarafında (bizde) koşulan kontrol:

```sh
bun run check:consumer <tüketici-proje-yolu>
```

---

## Dikkat

- **`@hono/zod-validator`'ı `package.json`'dan kaldırma** — `/http/validation`
  kullanmaya devam ediyorsan hâlâ gerekli. Bu sürüm onu opsiyonel *yapmadı*,
  yalnızca **gerektirmeyen modülleri ondan kurtardı**.
- **Kök barrel yok.** `@mustafakurtt/hono-core` diye içe aktarma; her modül
  kendi alt yolundan gelir.
- **Sürümü etikete kilitle** (`#v0.2.0`), `main`'e bağlanma. Aksi halde bir
  sonraki değişiklik habersiz gelir.
- Bu sürüm henüz **etiketlenmedi**; `package.json` hâlâ `0.1.0`. Etiket
  atılmadan tüketicileri güncelleme.

---

## Bu sürüme henüz girmemiş, planlanan maddeler

Aşağıdakiler v0.2.0 hedefinde ama **henüz yapılmadı** — bu notta karşılıkları
yok, geldiklerinde eklenecek:

`T-2` zod→HTTP hata köprüsü · `C-4` `generatePassword` karakter sınıfı
düzeltmesi · `C-6` `LocalDiskStorage` iç içe key desteği · `C-2` doküman ve
`NodeJS.Signals` bağımlılığının düşürülmesi · `C-7` peer aralığı ·
`C-8` eksik testler

Ayrıntı: [`../02-yol-haritasi.md`](../02-yol-haritasi.md)

---

## Bağlantılar

- Bulgu kataloğu: [`../01-bulgular.md`](../01-bulgular.md) — `C-1`, `T-6`
- Yol haritası: [`../02-yol-haritasi.md`](../02-yol-haritasi.md)
