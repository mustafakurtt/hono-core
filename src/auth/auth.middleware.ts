import type { Context, Next } from "hono";
import { createAuth, type TokenVerifier } from "./auth.factory";
import { bearerToken, type TokenExtractor } from "./token-source";

/**
 * Doğrulanmış token claim'lerinin şekli. core/ proje-bağımsız kalsın diye burada
 * BOŞTUR: hangi alanların (userId, tenant vb.) taşınacağını PROJE, declaration
 * merging ile belirler:
 *
 *   declare module "@mustafakurtt/hono-core/auth" {
 *     interface AuthClaims { userId: string; ... }
 *   }
 *
 * Böylece core hiçbir proje alanını (universityId gibi) İSMEN bilmez; middleware
 * payload'ı opak taşır, alanlara core değil proje (resolver'lar) erişir.
 */
export interface AuthClaims {}

export type Variables = {
  user: AuthClaims;
};

export type { TokenVerifier };

/**
 * SÜREÇ-GENELİ TEK ÖRNEK — `createAuth`'un (bkz. `auth.factory.ts`) global
 * kurulumu. Tek uygulamalı projeler için pratiktir ve mevcut kodla uyumludur;
 * aynı süreçte iki farklı yapılandırma gerekiyorsa fabrika kullanılmalıdır.
 *
 * DİKİŞ: doğrulama SECRET'e (env) ihtiyaç duyar, o yüzden core import ETMEZ —
 * açılışta enjekte edilir.
 */
let verifier: TokenVerifier | null = null;
let extractor: TokenExtractor = bearerToken;

export function setTokenVerifier(fn: TokenVerifier) {
  verifier = fn;
}

/**
 * Token'ın nereden okunacağını değiştirir (ör. oturum çerezi). Varsayılan
 * `Authorization: Bearer`. Fabrikaya geçmek istemeyen projeler için kısa yol;
 * bkz. `cookieToken` / `firstToken`.
 */
export function setTokenExtractor(fn: TokenExtractor) {
  extractor = fn;
}

/**
 * `Authorization: Bearer <token>` (ya da `setTokenExtractor` ile verilen kaynak)
 * okur, doğrular, `user` context değişkenini kurar. Başarısızlıkta mesaj
 * ANAHTARI fırlatır → app.onError tek noktadan 401 + i18n zarfına çevirir.
 */
export const authMiddleware = async (c: Context<{ Variables: Variables }>, next: Next) => {
  if (!verifier) {
    // Yapılandırma hatası (açılışta setTokenVerifier çağrılmadı) → jenerik 500.
    throw new Error("Token doğrulayıcı ayarlanmadı: setTokenVerifier çağrılmalı.");
  }
  // Her istekte kurulur: dikişler açılıştan sonra da değiştirilebilir olmalı
  // (testler, sıcak yeniden yapılandırma). Maliyeti bir kapanış nesnesidir.
  await createAuth({ verify: verifier, extract: extractor }).middleware(c, next);
};
