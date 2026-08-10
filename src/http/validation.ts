import { zValidator } from "@hono/zod-validator";
import type { Context, ValidationTargets } from "hono";
import type { ZodError, ZodType } from "zod";
import type { Translate } from "../i18n/translator";
import { createZodErrorMapper, type ZodErrorFormatter } from "./zod-error";

/**
 * Taşınabilir doğrulama katmanı (HTTP KENARI). `@hono/zod-validator`'ın
 * varsayılan davranışı ham `ZodError`'u bizim zarfımız DIŞINDA döndürür
 * (message/requestId/code yok, iç zod yapısı + İngilizce metin sızar). Bu
 * fabrika onu sarıp `ValidationError` FIRLATIR — böylece hata, iş/altyapı
 * hatalarıyla AYNI `app.onError` yolundan geçer: tek hata çıkışı.
 *
 * Çeviri kuralının kendisi burada DEĞİL, kenar-bağımsız `./zod-error`
 * köprüsündedir; bu dosya yalnızca köprüyü Hono'nun doğrulama hook'una bağlar.
 * Aynı köprü servis katmanındaki `safeParse` için de kullanılır, böylece iki
 * yolda da aynı zarf üretilir.
 *
 * Bu modül `@hono/zod-validator` peer'ını gerektirdiği için `/http` barrel'ında
 * DEĞİL, `@mustafakurtt/hono-core/http/validation` alt yolundadır.
 */
export interface CreateValidatorOptions {
  formatError: ZodErrorFormatter;
  translate?: Translate;
  getLocale?: (c: Context) => string;
}

export function createValidator({
  formatError,
  translate,
  getLocale = (c) => (c.get("locale") as string | undefined) ?? "",
}: CreateValidatorOptions) {
  const mapper = createZodErrorMapper({ format: formatError, translate });

  return <Target extends keyof ValidationTargets, Schema extends ZodType>(
    target: Target,
    schema: Schema
  ) =>
    zValidator(target, schema, (result, c) => {
      if (!result.success) {
        // @hono/zod-validator sonucu core `$ZodError` olarak etiketler; runtime'da
        // nesne gerçek classic `ZodError`'dur, bu yüzden cast tipçe güvenlidir.
        throw mapper.toValidationError(result.error as unknown as ZodError, getLocale(c));
      }
    });
}
