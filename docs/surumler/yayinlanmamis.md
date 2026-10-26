# Yayınlanmamış (v0.5.0 hedefi)

**Tek cümlelik özet:** Tüketicilerin kendi `packages/core`'unda kopya taşıdığı
dört saf yardımcı (IP, e-posta anahtarı, sayfalama, denetim farkı) artık core'da.

**Kırıcı mı:** Hayır. Yalnızca ekleme; mevcut hiçbir export değişmedi.

---

## Etki

| Tüketici | Etkilenir mi | Gereken iş |
|---|---|---|
| rfcear | Hayır (isteğe bağlı geçiş) | `@rfcear/core`'daki kopyaları silip core'dan import etmek — ilk geçen proje |
| laputa-next | Hayır (isteğe bağlı geçiş) | rfcear ile aynı geçiş, rfcear canlıda doğrulandıktan sonra |
| fenixAVM-bun | Hayır | Yok — bu yardımcıların kopyası yok |

---

## Yapılacaklar

Hiçbir şey yapman gerekmiyor. Kopyaları kaldırmak isteyen tüketici için:

```diff
- import { paginate } from "@rfcear/core/db";
+ import { paginate } from "@mustafakurtt/hono-core/db";

- import { emailKey } from "@rfcear/core/mail";
+ import { emailKey } from "@mustafakurtt/hono-core/ratelimit";

- import { diffChanges } from "@rfcear/core/rbac";
+ import { diffChanges } from "@mustafakurtt/hono-core/rbac";

- import { clientIp, clientKey } from "@rfcear/core/http";
+ // shared/client-ip.ts — proxy kararı projede, bir kez:
+ import { createClientIp } from "@mustafakurtt/hono-core/http";
+ const clientIpResolver = createClientIp({ trustedProxies: 1 });
+ export const clientIp = clientIpResolver.ip;
+ export const clientKey = clientIpResolver.key;
```

---

## Değişiklikler

### Kırıcı
Yok.

### Eklendi
- `/http`: `createClientIp({ trustedProxies, header?, remoteAddress? })` ve `ipKey`.
  `trustedProxies` zorunludur, varsayılanı yoktur: proxy başlığına güvenmek
  projenin kararıdır. Başlık değeri **sağdan** seçilir (ekleyen proxy
  zincirlerinde ziyaretçinin soldaki uydurması atlanır).
- `/ratelimit`: `emailKey` — aynı posta kutusunun varyantlarını tek anahtara indirir.
  `/mail` yerine burada: `/mail` nodemailer'ı zorunlu kılar.
- `/db`: `paginate`, `Page`, `PaginateQuery` — ORM bilmeyen sayfalama kabuğu.
- `/rbac`: `diffChanges` — denetim kaydı için önce/sonra farkı.

### Düzeltildi
Yok.

### İç (tüketiciyi etkilemez)
- `bun.lock`, `package.json`'daki `drizzle-orm <2` sınırıyla eşitlendi.

---

## Doğrulama

```sh
bun run typecheck
bun test
```

---

## Dikkat

- `clientIp`'in eski hâli `X-Forwarded-For`'un **ilk** değerini alıyordu.
  `trustedProxies: 1` **son** değeri alır. Kenar proxy başlığı baştan yazıyorsa
  (rfcear'daki Caddy `header_up X-Forwarded-For {client_ip}`) başlıkta tek değer
  olduğu için sonuç aynıdır. Başlığa EKLEYEN bir proxy zinciri varsa sayıyı
  zincirdeki güvenilir proxy sayısına göre ver.

---

## Bağlantılar

- Bulgu kataloğu: [`../01-bulgular.md`](../01-bulgular.md) — `C-n` / `T-n`
- Yol haritası: [`../02-yol-haritasi.md`](../02-yol-haritasi.md)
