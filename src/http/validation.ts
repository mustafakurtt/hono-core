import { zValidator } from "@hono/zod-validator";
import type { Context, ValidationTargets } from "hono";
import type { ZodError, ZodType } from "zod";
import type { Translate } from "../i18n/translator";
import { ValidationError } from "./errors";

/**
 * Taşınabilir doğrulama katmanı. `@hono/zod-validator`'ın varsayılan davranışı
 * ham `ZodError`'u bizim zarfımız DIŞINDA döndürür (message/requestId/code yok,
 * iç zod yapısı + İngilizce metin sızar). Bu fabrika onu sarıp doğrulama
 * başarısızsa `ValidationError` FIRLATIR — böylece hata, iş/altyapı hatalarıyla
 * AYNI `app.onError` (core/http/error-handler) yolundan geçer: tek hata çıkışı.
 *
 * core/ dil bilmez: ZodError'un kullanıcıya nasıl gösterileceği `formatError` ile
 * enjekte edilir. `formatError`, isteğin diline bağlı bir `t(key, params)` alır —
 * doğrulama hook'u `c`'ye sahip olduğu için alan-bazlı mesajlar (issue code'undan)
 * ATILDIĞI ANDA çevrilebilir; bunun için issue param'ları (minimum/expected...) o
 * anda gerekir. `translate` verilmezse `t` anahtarı aynen döndürür (geri uyum).
 */
export interface CreateValidatorOptions {
  formatError: (
    error: ZodError,
    t: (key: string, params?: Record<string, unknown>) => string
  ) => { message: string; details?: unknown };
  translate?: Translate;
  getLocale?: (c: Context) => string;
}

export function createValidator({
  formatError,
  translate,
  getLocale = (c) => (c.get("locale") as string | undefined) ?? "",
}: CreateValidatorOptions) {
  return <Target extends keyof ValidationTargets, Schema extends ZodType>(
    target: Target,
    schema: Schema
  ) =>
    zValidator(target, schema, (result, c) => {
      if (!result.success) {
        const locale = getLocale(c);
        const t = (key: string, params?: Record<string, unknown>) =>
          translate ? translate(key, locale, params) : key;
        // @hono/zod-validator sonucu core `$ZodError` olarak etiketler; runtime'da
        // nesne gerçek classic `ZodError`'dur, bu yüzden cast tipçe güvenlidir.
        const { message, details } = formatError(result.error as unknown as ZodError, t);
        throw new ValidationError(message, { details });
      }
    });
}
