import { Context, Next } from "hono";
import { UnauthorizedError } from "../http/errors";

/**
 * Doğrulanmış token claim'lerinin şekli. core/ proje-bağımsız kalsın diye burada
 * BOŞTUR: hangi alanların (userId, tenant vb.) taşınacağını PROJE, declaration
 * merging ile belirler:
 *
 *   declare module ".../core/auth/auth.middleware" {
 *     interface AuthClaims { userId: string; ... }
 *   }
 *
 * Böylece core hiçbir proje alanını (universityId gibi) İSMEN bilmez; `authMiddleware`
 * payload'ı opak taşır, alanlara core değil proje (resolver'lar) erişir.
 */
export interface AuthClaims {}

export type Variables = {
  user: AuthClaims;
};

type TokenVerifier = (token: string) => Promise<AuthClaims | null>;

/**
 * DİKİŞ: token doğrulama SECRET'e (env) ihtiyaç duyar, o yüzden core import ETMEZ
 * — doğrulayıcı açılışta `setTokenVerifier` ile enjekte edilir (setGuardAuditSink
 * deseni). Böylece core/auth env/shared'a bağlanmaz.
 */
let verifier: TokenVerifier | null = null;

export function setTokenVerifier(fn: TokenVerifier) {
  verifier = fn;
}

/**
 * `Authorization: Bearer <token>` okur, doğrular, `user` context değişkenini kurar.
 * Başarısızlıkta Türkçe/zarf gömmez; `UnauthorizedError` (mesaj ANAHTARI) FIRLATIR
 * → app.onError tek noktadan 401 + i18n zarfına çevirir.
 */
export const authMiddleware = async (c: Context<{ Variables: Variables }>, next: Next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError("auth.tokenMissing");
  }

  if (!verifier) {
    // Yapılandırma hatası (açılışta setTokenVerifier çağrılmadı) → jenerik 500.
    throw new Error("Token doğrulayıcı ayarlanmadı: setTokenVerifier çağrılmalı.");
  }

  const payload = await verifier(authHeader.split(" ")[1]);
  if (!payload) {
    throw new UnauthorizedError("auth.tokenInvalid");
  }

  c.set("user", payload);
  await next();
};
