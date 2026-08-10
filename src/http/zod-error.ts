import type { ZodError } from "zod";
import type { Translate } from "../i18n/translator";
import { ValidationError } from "./errors";

/**
 * `ZodError` → `ValidationError` köprüsü. HTTP KENARINDAN BAĞIMSIZDIR: `Context`
 * almaz, middleware değildir, `@hono/zod-validator` gerektirmez (zod yalnızca
 * TİP olarak kullanılır).
 *
 * Neden ayrı: doğrulama her zaman rotada olmuyor. Şema çalışma anında
 * seçiliyorsa (ör. içerik tipine göre) `safeParse` servis katmanında çağrılır ve
 * `createValidator` oraya ulaşamaz. O durumda ham `ZodError` fırlatılırsa
 * merkezî hata yakalayıcı onu ALTYAPI hatası sayar ve istemci 500 görür —
 * oysa bu bir 400'dür.
 *
 * Bu köprü aynı biçimlendirme kuralını iki çağırana da verir: rotadaki
 * `createValidator` ve servisteki `safeParse`. Kural TEK yerde tanımlanır,
 * cevap zarfı iki yolda da aynı olur.
 *
 * core dil bilmez: mesajların nasıl üretileceği `format` ile enjekte edilir.
 */

/** Mesaj anahtarını isteğin diline çeviren fonksiyon; katalog yoksa anahtarı döndürür. */
export type MessageTranslator = (key: string, params?: Record<string, unknown>) => string;

/** `format`'ın ürettiği kullanıcı-cephesi çıktı. */
export interface FormattedZodError {
  /** Üst düzey mesaj (genelde bir çeviri anahtarı, ör. "validation.failed"). */
  message: string;
  /** Alan bazlı ayrıntı (ör. issue listesi). Cevaba olduğu gibi eklenir. */
  details?: unknown;
}

/**
 * `ZodError`'u kullanıcıya gösterilecek biçime çevirir. `t` ile alan mesajları
 * ATILDIĞI ANDA çevrilebilir — issue parametreleri (minimum, expected…) yalnızca
 * o anda elde olduğu için bu şarttır.
 */
export type ZodErrorFormatter = (error: ZodError, t: MessageTranslator) => FormattedZodError;

export interface CreateZodErrorMapperOptions {
  format: ZodErrorFormatter;
  /** Verilmezse `t` anahtarı aynen döndürür (i18n kullanmayan projeler için). */
  translate?: Translate;
}

export interface ZodErrorMapper {
  /**
   * `ValidationError` üretir — FIRLATMAZ, döndürür. Çağıran `throw` eder;
   * böylece hata, iş hatalarıyla aynı `app.onError` yolundan geçer.
   */
  toValidationError(error: ZodError, locale?: string): ValidationError;
}

const NEUTRAL_LOCALE = "";

export function createZodErrorMapper(options: CreateZodErrorMapperOptions): ZodErrorMapper {
  const { format, translate } = options;

  return {
    toValidationError(error, locale = NEUTRAL_LOCALE) {
      const t: MessageTranslator = (key, params) =>
        translate ? translate(key, locale, params) : key;
      const { message, details } = format(error, t);
      return new ValidationError(message, { details });
    },
  };
}
