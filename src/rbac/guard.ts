import { authMiddleware } from "../auth/auth.middleware";
import { attachAuthz, requirePermission, requireRole } from "./rbac.middleware";
import { enforceTenantScope } from "./tenant-scope";
import { auditTrail } from "./audit-hook";
import {
  buildGuardChain,
  type GuardChain,
  type GuardStep,
  type TenantScopedGuardChain,
} from "./guard-chain";
import { every } from "hono/combine";

/**
 * SÜREÇ-GENELİ guard zinciri — `createRbac(...).guard` (bkz. `rbac.factory.ts`)
 * bunun izole karşılığıdır ve yeni projelerde tercih edilmelidir.
 *
 * Burada zincirin "policy" adımı BOŞTUR: ek adım eklemek istiyorsan fabrikayı
 * kullan (`createRbac({ steps: [...] })`). Zincirin şekli ve sırası tek yerde
 * tanımlıdır (`guard-chain.ts`).
 */
export type GuardOptions = {
  /** true ise zincire enforceTenantScope() eklenir (configureTenantScope gerektirir). */
  tenantScoped?: boolean;
  /** tenantScoped: true iken path parametresinin adını özelleştirmek için. */
  tenantParam?: string;
};

/** Süreç-geneli kurulumda proje-özel ek adım yoktur; slot boş kalır. */
const NO_POLICY: GuardStep = every();

function chainFor(auditLabel: string, check: GuardStep, options?: GuardOptions) {
  return buildGuardChain({
    auth: authMiddleware,
    attachAuthz,
    policy: NO_POLICY,
    audit: auditTrail(auditLabel),
    check,
    tenantScope: options?.tenantScoped ? enforceTenantScope(options.tenantParam) : undefined,
  });
}

/**
 * İZİN-tabanlı guard: özne verilen izin anahtarını taşımalı.
 *   ...guard(UniversityPermission.MANAGE)
 */
export function guard(permissionKey: string): GuardChain;
export function guard(
  permissionKey: string,
  options: GuardOptions & { tenantScoped: true }
): TenantScopedGuardChain;
export function guard(permissionKey: string, options?: GuardOptions) {
  return chainFor(permissionKey, requirePermission(permissionKey), options);
}

/**
 * ROL-tabanlı guard: özne verilen role sahip olmalı. İzin kataloğu kurmak
 * istemeyen projeler için.
 *   ...guardRole("admin")
 */
export function guardRole(roleName: string): GuardChain;
export function guardRole(
  roleName: string,
  options: GuardOptions & { tenantScoped: true }
): TenantScopedGuardChain;
export function guardRole(roleName: string, options?: GuardOptions) {
  return chainFor(roleName, requireRole(roleName), options);
}
