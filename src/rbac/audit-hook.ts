import type { Context, Next } from "hono";
import type { RbacVariables } from "./rbac.types";
import { createLogger } from "../logger/logger";

// core/ proje-bağımsız kalmalı: shared/logger'ı DEĞİL, doğrudan core/logger'ı
// kendi başına örnekliyoruz (core → shared yönünde yeni bir bağımlılık eklemez).
const log = createLogger({ bindings: { module: "core.rbac.audit-hook" } });

/**
 * guard() zincirine takılan denetim izi (audit trail) kancası.
 *
 * core/ proje-bağımsız kalmalı: bu dosya yalnızca KANCA MEKANİZMASINI tanımlar,
 * kaydın NEREYE ve NASIL yazılacağını bilmez. Projeye özgü implementasyon
 * (DB tablosu, alan türetme, maskeleme) `setGuardAuditSink` ile ya da fabrikaya
 * `audit` seçeneğiyle enjekte edilir. Sink kayıtlı değilse kanca sıfır maliyetli
 * bir no-op'tur — core başka projeye taşındığında audit özelliği olmadan da
 * aynen çalışır.
 */
export type GuardAuditSink = (
  c: Context<{ Variables: RbacVariables }>,
  permissionKey: string
) => void | Promise<void>;

/** Bir isteğin denetim izine yazılıp yazılmayacağına karar verir. */
export type AuditPredicate = (c: Context<{ Variables: RbacVariables }>) => boolean;

let sink: GuardAuditSink | null = null;

export function setGuardAuditSink(nextSink: GuardAuditSink) {
  sink = nextSink;
}

/** Durumu değiştirmeyen metodlar; varsayılan olarak denetim izine yazılmaz. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Varsayılan predikat: yalnızca durum değiştiren istekler kaydedilir (okuma
 * gürültüsünü keser).
 *
 * Bu bir POLİTİKADIR ve her projeye uymaz: kişisel veri döken bir dışa aktarma
 * ucu GET olsa bile iz bırakmalıdır. Bu yüzden değiştirilebilir — `auditTrail`'e
 * ya da fabrikaya `shouldAudit` geçilir.
 */
export const isMutation: AuditPredicate = (c) => !READ_METHODS.has(c.req.method);

export interface AuditTrailOptions {
  /** Kaydı yazan. Verilmezse modül düzeyindeki sink (`setGuardAuditSink`). */
  sink?: GuardAuditSink;
  /** Hangi isteklerin kaydedileceği. Varsayılan `isMutation`. */
  shouldAudit?: AuditPredicate;
}

/**
 * guard() zincirinde yetki kontrolünden ÖNCE durur: `next()`'i sardığı için
 * yetki reddini (403) de, başarılı işlemi de görür — reddedilmiş bir
 * yetkili-işlem DENEMESİ de denetim izinin parçasıdır.
 *
 * Sink hatası isteği ASLA düşürmez: denetim kaydı yan etkidir, asıl işlemin
 * sonucunu değiştiremez.
 */
export const auditTrail = (permissionKey: string, options: AuditTrailOptions = {}) => {
  const { shouldAudit = isMutation } = options;

  return async (c: Context<{ Variables: RbacVariables }>, next: Next) => {
    await next();

    // Sink her istekte çözülür: fabrikaya verilmediyse global kayıt kullanılır ve
    // o kayıt açılış sırasından bağımsız olarak geçerli olur.
    const write = options.sink ?? sink;
    if (!write || !shouldAudit(c)) return;

    try {
      await write(c, permissionKey);
    } catch (error) {
      log.warn({ err: error, permissionKey }, "denetim kaydı yazılamadı");
    }
  };
};
