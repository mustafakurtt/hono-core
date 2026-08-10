import { authMiddleware } from "../auth/auth.middleware";
import type { AuthClaims } from "../auth/auth.middleware";
import { createRbac, type Rbac } from "./rbac.factory";
import type { GuardStep } from "./guard-chain";
import type { AuthzContext, RbacVariables } from "./rbac.types";

export type { RbacVariables };

/**
 * SÜREÇ-GENELİ TEK ÖRNEK — `createRbac`'ın (bkz. `rbac.factory.ts`) global
 * kurulumu. Tek uygulamalı projeler için pratiktir; aynı süreçte iki farklı
 * yapılandırma ya da izole testler gerekiyorsa fabrika kullanılmalıdır.
 *
 * DİKİŞ: projeye özgü HER ŞEY enjekte edilir. Core ne alan adı (userId) ne rol
 * adı (super_admin) İSMEN bilir; izin kaynağı da enjekte edildiği için core/rbac
 * projeye HİÇ bağlı değildir.
 *
 * Sözleşme MİNİMALDİR: özne kimliği + authz çözümü. Hesap durumu gibi proje
 * POLİTİKALARI `enforce` ile, zincire giren ek adımlar ise fabrikanın `steps`
 * seçeneğiyle eklenir. Tenant-scope AYRI bir modüldür (tenant-scope.ts).
 */
export interface RbacConfig {
  /** Kullanıcı payload'ından authz araması için özne kimliğini çıkarır. */
  getSubjectId: (user: AuthClaims) => string;
  /** Bir öznenin çözülmüş authz bağlamını verir (proje: cache'li repo). */
  resolveAuthz: (subjectId: string) => Promise<AuthzContext>;
  /**
   * Resolve SONRASI proje politikası (opsiyonel). Erişim reddediliyorsa FIRLATIR
   * (ör. askıya alınmış hesabı kesmek). Token claim'leri de verilir; tek
   * parametreli mevcut fonksiyonlar aynen çalışmaya devam eder.
   */
  enforce?: (authz: AuthzContext, user: AuthClaims) => void;
}

let config: RbacConfig | null = null;
let instance: Rbac | null = null;

export function configureRbac(next: RbacConfig) {
  config = next;
  instance = null; // yeniden yapılandırma bir sonraki istekte geçerli olsun
}

function rbac(): Rbac {
  if (!config) throw new Error("RBAC yapılandırılmadı: configureRbac çağrılmalı.");
  return (instance ??= createRbac({ auth: authMiddleware, ...config }));
}

/**
 * authMiddleware'den SONRA çalışmalıdır. Öznenin authz bağlamını çözüp context'e
 * ekler ve varsa proje politikasını uygular — böylece askıya alınan kullanıcının
 * erişimi bir sonraki istekte ANINDA kesilebilir (politika projede).
 */
export const attachAuthz: GuardStep = (c, next) => rbac().attachAuthz(c, next);

export const requirePermission =
  (key: string): GuardStep =>
  (c, next) =>
    rbac().requirePermission(key)(c, next);

export const requireRole =
  (roleName: string): GuardStep =>
  (c, next) =>
    rbac().requireRole(roleName)(c, next);
