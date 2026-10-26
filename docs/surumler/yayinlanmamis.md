# Yayınlanmamış (v0.6.0 hedefi)

**Tek cümlelik özet:** 2FA mekanizmaları (TOTP, secret-box, kurtarma kodları) ve
`createThrottle` artık core'da; tüketicilerin `packages/core/src/{auth,ratelimit}`
kopyaları silinebilir.

**Kırıcı mı:** Hayır. Yalnızca ekleme.

---

## Etki

| Tüketici | Etkilenir mi | Gereken iş |
|---|---|---|
| rfcear | Hayır (isteğe bağlı geçiş) | `@rfcear/core/auth` ve `/ratelimit` kopyalarını silip core'dan import etmek — ilk geçen proje |
| laputa-next | Hayır (isteğe bağlı geçiş) | rfcear ile aynı geçiş; kopyalar birebir aynı |
| fenixAVM-bun | Hayır | Bilinmiyor: kendi 2FA/throttle'ı varsa ayrıca karşılaştırılmalı |

---

## Yapılacaklar

Hiçbir şey yapman gerekmiyor. Kopyaları kaldırmak isteyen tüketici için:

```diff
-import { base32, generateSecret, matchStep, otpauthUri } from "@rfcear/core/auth";
-import { createSecretBox } from "@rfcear/core/auth";
+import { base32, createSecretBox, generateSecret, matchStep, otpauthUri } from "@mustafakurtt/hono-core/auth";
-export { generateRecoveryCodes, hashRecoveryCode } from "@rfcear/core/auth";
+export { generateRecoveryCodes, hashRecoveryCode } from "@mustafakurtt/hono-core/auth";
-import { hotp, stepAt } from "@rfcear/core/auth";
+import { hotp, stepAt } from "@mustafakurtt/hono-core/auth";
-import { createThrottle } from "@rfcear/core/ratelimit";
+import { createThrottle } from "@mustafakurtt/hono-core/ratelimit";
```

Silinecekler: `packages/core/src/auth/{totp,secret-box}.ts` + testleri,
`packages/core/src/ratelimit/throttle.ts` + testi ve barrel satırları.

---

## Değişiklikler

### Kırıcı
Yok.

### Eklendi
- `/auth`: TOTP (RFC 6238) — `generateSecret`, `base32`, `hotp`, `stepAt`,
  `matchStep` (±1 adım, kullanılmış adımı reddeder, sabit zamanlı karşılaştırma),
  `otpauthUri`. Adım süresi, hane sayısı ve pencere opsiyonel `TotpOptions` ile
  ayarlanabilir; varsayılanlar 30 sn, 6 hane, ±1.
- `/auth`: `createSecretBox(secret)` — küçük sırları AES-256-GCM ile mühürler.
  Biçim (`v1.<iv>.<tag>.<gövde>`, anahtar `sha256(secret)`) tüketici kopyalarıyla
  birebir aynıdır ve kilitlidir; eski kayıtlar açılmaya devam eder. Ayrıca
  `generateRecoveryCodes`, `hashRecoveryCode`, `SecretBox` tipi.
- `/ratelimit`: `createThrottle({ windowMs, max, maxKeys? })` — middleware
  olmayan, süreç içi, anahtar başına sabit pencere sayacı (hatalı kod/şifre
  denemeleri, denetim satırı seyreltme). `.blocked()` saymadan bakar. Bellek
  `maxKeys` (varsayılan 10.000) ile sınırlıdır; geçersiz ayar hata fırlatır.

### Düzeltildi
- `createThrottle({ maxKeys: 0 })` tüketici kopyasında sonsuz döngüye giriyordu;
  artık kurulumda hata fırlatır.

### İç (tüketiciyi etkilemez)
Yok.

---

## Doğrulama

```sh
bun run typecheck
bun test
```

2FA'sı açık bir hesapla girişin ve bir kurtarma koduyla girişin çalıştığını elle dene.

---

## Dikkat

- **secret-box anahtar metni değiştirilmemeli** (rfcear: `rfcear:totp:${AUTH_JWT_SECRET}`).
  Değişirse kayıtlı 2FA sırları açılamaz.
- `throttle` README'lerde "kayan pencere" diye anlatılıyordu; gerçekte anahtar
  başına **sabit** penceredir (ilk sayımda açılır, uzamaz). Davranış değişmedi,
  yalnızca tanım düzeltildi.
- `matchStep` deneme sınırı uygulamaz; hatalı denemeleri `createThrottle` ile sınırla.

---

## Bağlantılar

- Bulgu kataloğu: [`../01-bulgular.md`](../01-bulgular.md) — `C-n` / `T-n`
- Yol haritası: [`../02-yol-haritasi.md`](../02-yol-haritasi.md)
