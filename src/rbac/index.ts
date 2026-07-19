/**
 * core/rbac barrel — proje-bağımsız yetkilendirme motoru (HTTP kenarı).
 *
 * Core ne alan adı (userId/tenantId), ne rol adı, ne param adı İSMEN bilir:
 * hepsi `configureRbac` / `configureTenantScope` dikişlerinden enjekte edilir.
 * Denetim izi de aynı desenle `setGuardAuditSink` ile projeye bağlanır.
 */
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
export { auditTrail, setGuardAuditSink, type GuardAuditSink } from "./audit-hook";
export type { AuthzContext } from "./rbac.types";
