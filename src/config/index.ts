/**
 * core/config barrel — zod tabanlı ortam değişkeni doğrulama mekanizması.
 * Şema PROJEDE kalır, mekanizma burada: `createEnv(schema, { intro })`.
 *
 * `envBoolean` bilinçli bir yardımcıdır — `z.coerce.boolean()` "false" string'ini
 * true'ya çevirir, bu tuzağa düşmemek için.
 */
export { createEnv, envBoolean, type CreateEnvOptions } from "./env";
