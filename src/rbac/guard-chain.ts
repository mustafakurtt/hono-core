import type { MiddlewareHandler } from "hono";
import type { Variables } from "../auth/auth.middleware";
import type { RbacVariables } from "./rbac.types";

/**
 * Guard zincirinin ŞEKLİ — tek yerde tanımlı, hem fabrika hem süreç-geneli
 * kurulum bunu kullanır.
 *
 * Zincir SABİT UZUNLUKTA bir tuple'dır (dizi değil) ve bu bilinçlidir: Hono'nun
 * rota metodları `(...guard(key), validate(...), handler)` çağrısında doğru
 * overload'a eşleyebilmek için argüman sayısını DERLEME ZAMANINDA bilmek
 * zorundadır. Genel bir `MiddlewareHandler[]` olsaydı `c.req.param()` ve
 * `c.req.valid()` tipleri `{}`'e düşerdi.
 *
 * Bu yüzden proje-özel ek adımlar (ör. oturum iptali kontrolü) zincire AYRI
 * eleman olarak eklenmez; `hono/combine`'ın `every()`'si ile TEK bir "policy"
 * adımına katlanır. Böylece adım sayısı ne olursa olsun tuple uzunluğu sabit
 * kalır.
 *
 * Sıra sözleşmenin parçasıdır:
 *   auth → attachAuthz → policy → audit → check [→ tenantScope]
 *
 * `audit` kontrolden ÖNCEDİR: reddedilen (403) denemeler de denetim izine düşer.
 * `policy` `attachAuthz`tan SONRADIR: ek politikalar çözülmüş authz'ı görebilir.
 */
/** `authz` çözüldükten SONRA çalışan adımlar. */
export type GuardStep = MiddlewareHandler<{ Variables: RbacVariables }>;

/**
 * Kimlik adımı — zincirin İLK halkası. Ayrı bir tiptir çünkü çalıştığı anda
 * `authz` HENÜZ YOKTUR; yalnızca `user`'ı kurar. `GuardStep` ile yazılsaydı
 * middleware'lerin context tipi ters yönde (kontravaryant) uyuşmazdı.
 */
export type AuthStep = MiddlewareHandler<{ Variables: Variables }>;

export type GuardChain = readonly [AuthStep, GuardStep, GuardStep, GuardStep, GuardStep];

export type TenantScopedGuardChain = readonly [...GuardChain, GuardStep];

export interface GuardChainParts {
  auth: AuthStep;
  attachAuthz: GuardStep;
  policy: GuardStep;
  audit: GuardStep;
  check: GuardStep;
  /** Verilirse zincirin SONUNA eklenir (kontrolden sonra, kaynağa erişmeden önce). */
  tenantScope?: GuardStep;
}

export function buildGuardChain(parts: GuardChainParts): GuardChain | TenantScopedGuardChain {
  const chain = [parts.auth, parts.attachAuthz, parts.policy, parts.audit, parts.check] as const;
  return parts.tenantScope ? ([...chain, parts.tenantScope] as const) : chain;
}
