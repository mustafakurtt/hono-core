import { Context, Next } from "hono";
import { AuthClaims } from "../auth/auth.middleware";
import { ForbiddenError } from "../http/errors";
import { AuthzContext } from "./rbac.types";
import { RbacVariables } from "./rbac.middleware";

/**
 * Çok-tenant (multi-tenant) sınır zorlaması — RBAC'tan AYRI, OPSİYONEL bir eksen.
 * Sadece-rol veya tek-tenant projeler bu modülü hiç configure etmez ve tenant
 * guard'ı kullanmaz; böylece tenant kavramı çekirdek RBAC sözleşmesine yük olmaz.
 *
 * DİKİŞ: projeye özgü her şey enjekte edilir (tenant kimliği çözümü, path param adı,
 * bypass rol adları). Core ne alan adını (universityId) ne rol adını (super_admin)
 * İSMEN bilir.
 */
export interface TenantScopeConfig {
  /** Kullanıcı payload'ından tenant kimliğini çıkarır (yoksa null). */
  getTenantId: (user: AuthClaims) => string | null;
  /** tenantScoped rotalarda kıyaslanacak varsayılan path parametresinin adı. */
  paramName: string;
  /** Tenant sınırını aşabilen (çapraz-tenant) platform seviyesi rol adları. */
  bypassRoles: string[];
}

let config: TenantScopeConfig | null = null;

export function configureTenantScope(next: TenantScopeConfig) {
  config = next;
}

function cfg(): TenantScopeConfig {
  if (!config) {
    throw new Error(
      "Tenant-scope yapılandırılmadı: enforceTenantScope/guard({tenantScoped}) kullanmadan önce configureTenantScope çağrılmalı."
    );
  }
  return config;
}

/**
 * Bir öznenin tenant sınırlarını aşabildiği (platform seviyesi rolü olduğu) mı?
 * Bypass rol adları enjekte edilir (proje verisi).
 */
export const hasTenantScopeBypass = (authz: AuthzContext): boolean =>
  authz.roles.some((role) => cfg().bypassRoles.includes(role));

/**
 * Path'teki tenant parametresini kullanıcının kendi tenant'ıyla kıyaslar. Bypass
 * rolü taşıyanlar herhangi bir tenant'ı hedefleyebilir. Param adı verilmezse
 * `config.paramName`'e düşer; tenant kimliği enjekte edilen `getTenantId` ile alınır.
 */
export const enforceTenantScope = (paramName?: string) => {
  return async (c: Context<{ Variables: RbacVariables }>, next: Next) => {
    const targetTenantId = c.req.param(paramName ?? cfg().paramName);
    const authz = c.get("authz");

    if (hasTenantScopeBypass(authz)) {
      c.set("scopeTenantId", targetTenantId);
      return next();
    }

    // Tenant kimliği null ise (bypass'sız platform hesabı) karşılaştırma asla tutmaz
    // — tenant kaynaklarına erişim doğru şekilde reddedilir.
    const tenantId = cfg().getTenantId(c.get("user"));
    if (!tenantId || targetTenantId !== tenantId) {
      throw new ForbiddenError("rbac.tenantForbidden");
    }

    c.set("scopeTenantId", tenantId);
    await next();
  };
};
