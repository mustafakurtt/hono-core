import { z, type ZodType } from "zod";

/**
 * Taşınabilir ortam değişkeni yükleyici. core/ proje-bağımsız kalsın diye ŞEMA
 * projede tanımlanır; burası yalnızca MEKANİZMA: şemayı `process.env`'e karşı
 * doğrular, geçersizse alanları tek tek listeleyen OKUNUR bir hata fırlatır
 * (ham `schema.parse()` çıktısının aksine). Bu bir başlangıç/geliştirici hatasıdır
 * (API cevabı değil), bu yüzden i18n'e girmez; başlık `intro` ile projede.
 */
export interface CreateEnvOptions {
  /** Doğrulanacak kaynak. Varsayılan `process.env`. */
  source?: Record<string, string | undefined>;
  /** Hata başlığı (dil projede). Varsayılan İngilizce. */
  intro?: string;
}

export function createEnv<T>(schema: ZodType<T>, options: CreateEnvOptions = {}): T {
  const { source = process.env, intro = "Invalid environment variables:" } = options;
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`
    );
    throw new Error(`${intro}\n${lines.join("\n")}`);
  }
  return result.data;
}

/**
 * Boolean ortam değişkeni yardımcısı. `z.coerce.boolean()` KULLANILAMAZ:
 * Boolean("false") === true olduğu için "false" yazan herkes sessizce true alır.
 * Bu yardımcı yalnızca bilinen doğruluk değerlerini kabul eder (aksi = defaultValue).
 */
export const envBoolean = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((raw) => {
      if (raw === undefined || raw.trim() === "") return defaultValue;
      return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
    });
