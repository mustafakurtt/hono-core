import { Context, Next } from "hono";
import { Variables, AuthClaims } from "../auth/auth.middleware";
import { ForbiddenError } from "../http/errors";
import { AuthzContext } from "./rbac.types";

export type RbacVariables = Variables & {
  authz: AuthzContext;
  /** enforceTenantScope tarafından set edilir (bkz. tenant-scope.ts). Opsiyonel. */
  scopeTenantId?: string;
};

/**
 * DİKİŞ: RBAC motoru proje-bağımsız kalsın diye projeye özgü HER ŞEY enjekte edilir
 * (setGuardAuditSink deseni). Core ne alan adı (userId) ne rol adı (super_admin)
 * İSMEN bilir; izin kaynağı da (resolveAuthz) enjekte edildiği için core/rbac
 * shared'a HİÇ bağlı değildir.
 *
 * Sözleşme MİNİMALDİR: yalnızca özne kimliği + authz çözümü. Hesap durumu / rütbe
 * gibi proje POLİTİKALARI çekirdeğe girmez — `enforce` hook'u ile enjekte edilir.
 * Tenant-scope AYRI bir modüldür (tenant-scope.ts, ayrı configure) — sadece-rol
 * veya tek-tenant projeler tenant'ı hiç yapılandırmaz.
 */
export interface RbacConfig {
  /** Kullanıcı payload'ından authz araması için özne kimliğini çıkarır. */
  getSubjectId: (user: AuthClaims) => string;
  /** Bir öznenin çözülmüş authz bağlamını verir (proje: Redis cache'li repo). */
  resolveAuthz: (subjectId: string) => Promise<AuthzContext>;
  /**
   * Resolve SONRASI proje politikası (opsiyonel). `attachAuthz` her istekte çağırır;
   * erişim reddediliyorsa FIRLATIR (ör. suspended hesabı kesmek). Verilmezse
   * politika uygulanmaz — core "suspended" gibi bir kavramı bilmez.
   */
  enforce?: (authz: AuthzContext) => void;
}

let config: RbacConfig | null = null;

export function configureRbac(next: RbacConfig) {
  config = next;
}

function cfg(): RbacConfig {
  if (!config) throw new Error("RBAC yapılandırılmadı: configureRbac çağrılmalı.");
  return config;
}

/**
 * authMiddleware'den SONRA çalışmalıdır. Öznenin authz bağlamını çözüp context'e
 * ekler ve varsa proje politikasını (`enforce`) uygular — böylece askıya alınan
 * kullanıcının erişimi bir sonraki istekte ANINDA kesilebilir (politika projede).
 */
export const attachAuthz = async (c: Context<{ Variables: RbacVariables }>, next: Next) => {
  const authz = await cfg().resolveAuthz(cfg().getSubjectId(c.get("user")));
  cfg().enforce?.(authz);
  c.set("authz", authz);
  await next();
};

export const requirePermission = (key: string) => {
  return async (c: Context<{ Variables: RbacVariables }>, next: Next) => {
    if (!c.get("authz").permissions.includes(key)) {
      throw new ForbiddenError("rbac.forbidden");
    }
    await next();
  };
};

export const requireRole = (roleName: string) => {
  return async (c: Context<{ Variables: RbacVariables }>, next: Next) => {
    if (!c.get("authz").roles.includes(roleName)) {
      throw new ForbiddenError("rbac.forbidden");
    }
    await next();
  };
};
