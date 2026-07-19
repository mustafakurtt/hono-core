import type { Context, Next } from "hono";
import type { RbacVariables } from "./rbac.middleware";
import { createLogger } from "../logger/logger";

// core/ proje-bağımsız kalmalı: shared/logger'ı DEĞİL, doğrudan core/logger'ı
// kendi başına örnekliyoruz (core → shared yönünde yeni bir bağımlılık eklemez).
const log = createLogger({ bindings: { module: "core.rbac.audit-hook" } });

/**
 * guard() zincirine takılan denetim izi (audit trail) kancası.
 *
 * core/ proje-bağımsız kalmalı: bu dosya yalnızca KANCA MEKANİZMASINI tanımlar,
 * kaydın NEREYE ve NASIL yazılacağını bilmez. Projeye özgü implementasyon
 * (DB tablosu, alan türetme, maskeleme) uygulama açılışında `setGuardAuditSink`
 * ile enjekte edilir (bkz. features/audit/audit.sink.ts). Sink kayıtlı değilse
 * kanca sıfır maliyetli bir no-op'tur — core başka projeye kopyalandığında
 * audit özelliği olmadan da aynen çalışır.
 */
export type GuardAuditSink = (
  c: Context<{ Variables: RbacVariables }>,
  permissionKey: string
) => void | Promise<void>;

let sink: GuardAuditSink | null = null;

export function setGuardAuditSink(nextSink: GuardAuditSink) {
  sink = nextSink;
}

/** Okuma istekleri denetim izine yazılmaz (gürültü); yalnızca durum değiştirenler. */
const SKIP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * guard() zincirinde attachAuthz'dan SONRA, requirePermission'dan ÖNCE durur:
 * `next()`'i sardığı için yetki reddini (403) de, başarılı işlemi de görür —
 * reddedilmiş bir yetkili-işlem DENEMESİ de denetim izinin parçasıdır.
 *
 * Sink hatası isteği ASLA düşürmez: denetim kaydı yan etkidir, asıl işlemin
 * sonucunu değiştiremez (notifySafe ile aynı ilke).
 */
export const auditTrail = (permissionKey: string) => {
  return async (c: Context<{ Variables: RbacVariables }>, next: Next) => {
    await next();
    if (!sink || SKIP_METHODS.has(c.req.method)) return;
    try {
      await sink(c, permissionKey);
    } catch (error) {
      log.warn({ err: error, permissionKey }, "denetim kaydı yazılamadı");
    }
  };
};
