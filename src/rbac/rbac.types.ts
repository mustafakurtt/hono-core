/**
 * Bir öznenin çözülmüş yetkilendirme bağlamı — RBAC motorunun karar için ihtiyaç
 * duyduğu MİNİMAL sözleşme. core/ proje-bağımsız kalsın diye yalnızca `roles` +
 * `permissions` taşır; hesap durumu (suspended), rütbe (rank), tenant gibi
 * PROJE-ÖZEL alanlar buraya girmez.
 *
 * Proje ek alan gerektiriyorsa `AuthClaims` desenindeki gibi DECLARATION MERGING
 * ile genişletir (bkz. shared/rbac/authz.ts) — core bu alanları İSMEN bilmese de
 * proje kendi middleware'lerinde/servislerinde okuyabilir:
 *
 *   declare module ".../core/rbac/rbac.types" {
 *     interface AuthzContext { status?: "..."; maxRank: number }
 *   }
 */
export interface AuthzContext {
  roles: string[];
  permissions: string[];
}
