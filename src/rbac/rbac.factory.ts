import { every } from "hono/combine";
import type { Context, Next } from "hono";
import type { AuthClaims } from "../auth/auth.middleware";
import { ForbiddenError } from "../http/errors";
import { auditTrail, type AuditPredicate, type GuardAuditSink } from "./audit-hook";
import {
  buildGuardChain,
  type AuthStep,
  type GuardChain,
  type GuardStep,
  type TenantScopedGuardChain,
} from "./guard-chain";
import type { AuthzContext, RbacVariables } from "./rbac.types";

/**
 * RBAC FABRİKASI — core'un asıl formu.
 *
 * Modül düzeyi `configureRbac` + `guard` ikilisi (bkz. `rbac.middleware.ts`,
 * `guard.ts`) bunun süreç-genelinde tek bir örneğidir ve geriye uyum için
 * korunur. Fabrika üç şeyi mümkün kılar; üçü de tüketicide gerçek sürtünme
 * yarattı:
 *
 *   1. **Kimlik adımı enjekte edilir.** Çerezle oturum taşıyan proje, zinciri
 *      baştan yazmak yerine kendi `auth` middleware'ini verir.
 *   2. **Ek politika adımı.** `enforce` yalnızca çözülmüş authz'ı görür;
 *      token claim'lerine bakan bir kontrol (ör. `tokenVersion` ile oturum
 *      iptali) oraya sığmaz. `steps` tam da bu boşluk için: `attachAuthz`tan
 *      sonra, yetki kontrolünden önce çalışır.
 *   3. **Tipli izin anahtarı.** `Key` union'ı verilirse var olmayan bir anahtar
 *      DERLEME hatası olur (`createResponder`'ın mesaj anahtarlarında yaptığının
 *      aynısı).
 */

/** Yetki kontrolü öncesi çalışan proje-özel politika adımı. */
export type PolicyStep = GuardStep;

export interface CreateRbacOptions {
  /** Kimlik doğrulama adımı — genelde `createAuth({...}).middleware`. */
  auth: AuthStep;
  /** Kullanıcı payload'ından authz araması için özne kimliğini çıkarır. */
  getSubjectId: (user: AuthClaims) => string;
  /** Bir öznenin çözülmüş authz bağlamını verir (proje: cache'li repo). */
  resolveAuthz: (subjectId: string) => Promise<AuthzContext>;
  /**
   * Resolve SONRASI proje politikası. Erişim reddediliyorsa FIRLATIR.
   * Token claim'leri de verilir — hesap durumu kadar oturum sürümü gibi
   * claim-bağımlı kontroller de buraya sığsın diye.
   */
  enforce?: (authz: AuthzContext, user: AuthClaims) => void;
  /**
   * `attachAuthz`tan sonra, yetki kontrolünden önce çalışacak ek adımlar.
   * Tek bir adıma katlanır; zincirin uzunluğu değişmez (bkz. `guard-chain.ts`).
   */
  steps?: readonly PolicyStep[];
  /** Denetim kaydını yazan. Verilmezse `setGuardAuditSink` ile kurulan global sink. */
  audit?: GuardAuditSink;
  /** Hangi isteklerin denetleneceği. Varsayılan: durum değiştirenler. */
  shouldAudit?: AuditPredicate;
}

export interface RbacGuardOptions {
  /** Zincirin sonuna eklenen tenant sınırı adımı (bkz. `enforceTenantScope`). */
  tenantScope: GuardStep;
}

/**
 * `guard`/`guardRole` OVERLOAD'LUDUR, union döndürmez. Union olsaydı Hono'nun
 * rota metoduna yapılan spread (`...rbac.guard(key)`) argüman sayısını çözemez,
 * `c.req.param()` / `c.req.valid()` tipleri `{}`'e düşerdi.
 */
export interface Rbac<Key extends string = string> {
  /** Özneyi çözüp `authz` context değişkenini kurar; `enforce` politikasını uygular. */
  attachAuthz: GuardStep;
  requirePermission(key: Key): GuardStep;
  requireRole(roleName: string): GuardStep;
  /** İZİN tabanlı guard zinciri. */
  guard(key: Key): GuardChain;
  guard(key: Key, options: RbacGuardOptions): TenantScopedGuardChain;
  /** ROL tabanlı guard zinciri (izin kataloğu kurmayan projeler için). */
  guardRole(roleName: string): GuardChain;
  guardRole(roleName: string, options: RbacGuardOptions): TenantScopedGuardChain;
}

export function createRbac<Key extends string = string>(options: CreateRbacOptions): Rbac<Key> {
  const { auth, getSubjectId, resolveAuthz, enforce, steps = [], audit, shouldAudit } = options;

  // Adımlar tek bir middleware'e katlanır → tuple uzunluğu sabit kalır.
  const policy: GuardStep = every(...steps);

  const attachAuthz: GuardStep = async (c: Context<{ Variables: RbacVariables }>, next: Next) => {
    const user = c.get("user");
    const authz = await resolveAuthz(getSubjectId(user));
    enforce?.(authz, user);
    c.set("authz", authz);
    await next();
  };

  const requirePermission = (key: Key): GuardStep => {
    return async (c, next) => {
      if (!c.get("authz").permissions.includes(key)) throw new ForbiddenError("rbac.forbidden");
      await next();
    };
  };

  const requireRole = (roleName: string): GuardStep => {
    return async (c, next) => {
      if (!c.get("authz").roles.includes(roleName)) throw new ForbiddenError("rbac.forbidden");
      await next();
    };
  };

  const chainFor = (auditLabel: string, check: GuardStep, guardOptions?: RbacGuardOptions) =>
    buildGuardChain({
      auth,
      attachAuthz,
      policy,
      audit: auditTrail(auditLabel, { sink: audit, shouldAudit }),
      check,
      tenantScope: guardOptions?.tenantScope,
    });

  return {
    attachAuthz,
    requirePermission,
    requireRole,
    guard: ((key: Key, guardOptions?: RbacGuardOptions) =>
      chainFor(key, requirePermission(key), guardOptions)) as Rbac<Key>["guard"],
    guardRole: ((roleName: string, guardOptions?: RbacGuardOptions) =>
      chainFor(roleName, requireRole(roleName), guardOptions)) as Rbac<Key>["guardRole"],
  };
}
