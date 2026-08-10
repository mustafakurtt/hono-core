import type { Variables } from "../auth/auth.middleware";

/**
 * Bir öznenin çözülmüş yetkilendirme bağlamı — RBAC motorunun karar için ihtiyaç
 * duyduğu MİNİMAL sözleşme. core/ proje-bağımsız kalsın diye yalnızca `roles` +
 * `permissions` taşır; hesap durumu (suspended), rütbe (rank), tenant gibi
 * PROJE-ÖZEL alanlar buraya girmez.
 *
 * Proje ek alan gerektiriyorsa `AuthClaims` desenindeki gibi DECLARATION MERGING
 * ile genişletir — core bu alanları İSMEN bilmese de proje kendi
 * middleware'lerinde/servislerinde okuyabilir:
 *
 *   declare module "@mustafakurtt/hono-core/rbac" {
 *     interface AuthzContext { status?: "..."; maxRank: number }
 *   }
 */
export interface AuthzContext {
  roles: string[];
  permissions: string[];
}

/**
 * RBAC zincirinin context'e yazdığı değişkenler. `authz` `attachAuthz` ile,
 * `scopeTenantId` `enforceTenantScope` ile kurulur (bkz. tenant-scope.ts).
 */
export type RbacVariables = Variables & {
  authz: AuthzContext;
  scopeTenantId?: string;
};
