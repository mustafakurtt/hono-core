/**
 * core/auth barrel — proje-bağımsız kimlik doğrulama mekanizması.
 *
 * `AuthClaims` KASITLI olarak boştur: proje kendi alanlarını (userId, tenantId…)
 * declaration merging ile doldurur, böylece core hiçbir proje alanını bilmez.
 *
 * İki kullanım biçimi var, ikisi de desteklenir:
 *   - `createAuth({ verify, extract })` — fabrika (asıl form; izole, çoklu örnek)
 *   - `setTokenVerifier(fn)` + `authMiddleware` — süreç-geneli tek örnek
 */
export {
  authMiddleware,
  setTokenVerifier,
  setTokenExtractor,
  type AuthClaims,
  type Variables,
  type TokenVerifier,
} from "./auth.middleware";

export { createAuth, type Auth, type CreateAuthOptions } from "./auth.factory";
export { bearerToken, cookieToken, firstToken, type TokenExtractor } from "./token-source";

export { createJwt, type CreateJwtOptions } from "./jwt";
export { hashPassword, verifyPassword, generatePassword } from "./password";

// 2FA mekanizması: TOTP (RFC 6238) + veritabanındaki sırrı mühürleyen kutu + kurtarma kodları.
// "Kimde 2FA zorunlu", issuer adı ve kutunun anahtar metni projenin kararıdır.
export {
  base32,
  generateSecret,
  hotp,
  matchStep,
  otpauthUri,
  stepAt,
  type TotpOptions,
} from "./totp";
export { createSecretBox, generateRecoveryCodes, hashRecoveryCode, type SecretBox } from "./secret-box";
