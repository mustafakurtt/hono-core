/**
 * core/rbac barrel — proje-bağımsız yetkilendirme motoru (HTTP kenarı).
 *
 * Core ne alan adı (userId/tenantId), ne rol adı, ne param adı İSMEN bilir:
 * hepsi enjekte edilir. İki kullanım biçimi vardır, ikisi de desteklenir:
 *
 *   - `createRbac({ auth, getSubjectId, resolveAuthz, steps })` — fabrika.
 *     Asıl form: kimlik adımı, ek politika adımları ve tipli izin anahtarı
 *     buradan gelir; süreç durumu tutmaz.
 *   - `configureRbac(...)` + `guard(...)` — süreç-geneli tek örnek. Tek
 *     uygulamalı projeler için pratiktir, mevcut kodla uyumludur.
 */
export { createRbac, type CreateRbacOptions, type PolicyStep, type Rbac, type RbacGuardOptions } from "./rbac.factory";

export {
  configureRbac,
  attachAuthz,
  requirePermission,
  requireRole,
  type RbacConfig,
  type RbacVariables,
} from "./rbac.middleware";

export {
  configureTenantScope,
  enforceTenantScope,
  hasTenantScopeBypass,
  type TenantScopeConfig,
} from "./tenant-scope";

export { guard, guardRole, type GuardOptions } from "./guard";

export {
  auditTrail,
  isMutation,
  setGuardAuditSink,
  type AuditPredicate,
  type AuditTrailOptions,
  type GuardAuditSink,
} from "./audit-hook";

export type {
  AuthStep,
  GuardChain,
  GuardStep,
  TenantScopedGuardChain,
} from "./guard-chain";

export {
  bootstrapPermissions,
  totalChanges,
  type BootstrapReport,
  type PermissionCatalog,
  type PermissionDefinition,
  type PermissionStore,
  type RoleDefinition,
  type RolePermissionLink,
} from "./permission-bootstrap";

export type { AuthzContext } from "./rbac.types";
