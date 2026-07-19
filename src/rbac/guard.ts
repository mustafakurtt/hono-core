import type { MiddlewareHandler } from "hono";
import { authMiddleware } from "../auth/auth.middleware";
import { attachAuthz, requirePermission, requireRole, RbacVariables } from "./rbac.middleware";
import { enforceTenantScope } from "./tenant-scope";
import { auditTrail } from "./audit-hook";

export type GuardOptions = {
  /** true ise zincire enforceTenantScope() eklenir (configureTenantScope gerektirir). */
  tenantScoped?: boolean;
  /** tenantScoped: true iken path parametresinin adını özelleştirmek için (verilmezse config.paramName). */
  tenantParam?: string;
};

type BaseGuardChain = readonly [
  typeof authMiddleware,
  typeof attachAuthz,
  MiddlewareHandler<{ Variables: RbacVariables }>,
  MiddlewareHandler<{ Variables: RbacVariables }>
];

type TenantScopedGuardChain = readonly [
  typeof authMiddleware,
  typeof attachAuthz,
  MiddlewareHandler<{ Variables: RbacVariables }>,
  MiddlewareHandler<{ Variables: RbacVariables }>,
  MiddlewareHandler<{ Variables: RbacVariables }>
];

/**
 * Her feature'ın kopyaladığı
 *   [authMiddleware, attachAuthz, auditTrail(label), <check>, enforceTenantScope()?]
 * zincirini tek noktadan üretir. auditTrail, kontrol adımından ÖNCE durur ki
 * reddedilen (403) yetkili-işlem denemeleri de denetim izine düşsün (bkz. audit-hook.ts).
 *
 * Not: Dönüş tipi bilinçli olarak sabit uzunlukta bir tuple (array değil) — Hono'nun
 * route metodları (...guard(key), zValidator(...), handler) rest parametrelerini doğru
 * overload'a eşleyebilmek için argüman sayısını derleme zamanında bilmek zorunda.
 * Genel bir "MiddlewareHandler[]" olsaydı path param tipleri (`c.req.param()`) ve
 * `zValidator` sonrası `c.req.valid(...)` çağrıları `{}`'e düşerdi.
 */
function buildChain(
  auditLabel: string,
  check: MiddlewareHandler<{ Variables: RbacVariables }>,
  options?: GuardOptions
): BaseGuardChain | TenantScopedGuardChain {
  const chain = [authMiddleware, attachAuthz, auditTrail(auditLabel), check] as const;
  if (!options?.tenantScoped) return chain;
  return [...chain, enforceTenantScope(options.tenantParam)] as const;
}

/**
 * İZİN-tabanlı guard: özne verilen izin anahtarını taşımalı.
 *   import { guard } from "../../core/rbac/guard";
 *   ...guard(UniversityPermission.MANAGE)
 */
export function guard(permissionKey: string): BaseGuardChain;
export function guard(permissionKey: string, options: GuardOptions & { tenantScoped: true }): TenantScopedGuardChain;
export function guard(permissionKey: string, options?: GuardOptions): BaseGuardChain | TenantScopedGuardChain {
  return buildChain(permissionKey, requirePermission(permissionKey), options);
}

/**
 * ROL-tabanlı guard: özne verilen role sahip olmalı. İzin kataloğu kurmak istemeyen,
 * "sadece rol mekanizması" yeten projeler için (guard ile aynı kompozisyon).
 *   ...guardRole("admin")
 */
export function guardRole(roleName: string): BaseGuardChain;
export function guardRole(roleName: string, options: GuardOptions & { tenantScoped: true }): TenantScopedGuardChain;
export function guardRole(roleName: string, options?: GuardOptions): BaseGuardChain | TenantScopedGuardChain {
  return buildChain(roleName, requireRole(roleName), options);
}
