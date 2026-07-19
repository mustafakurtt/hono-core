/**
 * core/auth barrel — proje-bağımsız kimlik doğrulama mekanizması.
 *
 * `AuthClaims` KASITLI olarak boştur: proje kendi alanlarını (userId, tenantId…)
 * declaration merging ile doldurur, böylece core hiçbir proje alanını bilmez.
 * Token doğrulayıcı `setTokenVerifier` dikişiyle startup'ta enjekte edilir.
 */
export {
  authMiddleware,
  setTokenVerifier,
  type AuthClaims,
  type Variables,
} from "./auth.middleware";

export { createJwt, type CreateJwtOptions } from "./jwt";
export { hashPassword, verifyPassword, generatePassword } from "./password";
