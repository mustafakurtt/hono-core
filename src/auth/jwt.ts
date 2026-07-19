import { sign, verify } from "hono/jwt";

type SignablePayload = Parameters<typeof sign>[0];

/**
 * Taşınabilir JWT fabrikası. core/ proje-bağımsız kalsın diye SECRET ve süre
 * dışarıdan verilir (env core'a girmez); payload şekli `Claims` generic'iyle
 * projeye bırakılır. `exp` claim'ini fabrika ekler — çağıran süreyle uğraşmaz.
 *
 * Algoritma varsayılan HS256 ve verify'da AÇIKÇA belirtilir: aksi halde bir
 * saldırgan `alg: none` veya asimetrik/simetrik karışıklığıyla imzayı atlatabilir.
 */
export interface CreateJwtOptions {
  secret: string;
  /** Token ömrü (saniye). sign, `exp = now + expiresInSeconds` ekler. */
  expiresInSeconds: number;
  algorithm?: "HS256" | "HS384" | "HS512";
}

export function createJwt<Claims extends Record<string, unknown>>(options: CreateJwtOptions) {
  const { secret, expiresInSeconds, algorithm = "HS256" } = options;

  return {
    async sign(claims: Claims): Promise<string> {
      const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
      return sign({ ...claims, exp } as SignablePayload, secret, algorithm);
    },

    /** Geçersiz/süresi dolmuş token'da fırlatmaz, `null` döner (çağıran karar verir). */
    async verify(token: string): Promise<(Claims & { exp: number }) | null> {
      try {
        return (await verify(token, secret, algorithm)) as unknown as Claims & { exp: number };
      } catch {
        return null;
      }
    },
  };
}
