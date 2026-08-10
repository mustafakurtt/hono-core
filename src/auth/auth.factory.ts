import type { Context, MiddlewareHandler, Next } from "hono";
import { UnauthorizedError } from "../http/errors";
import type { AuthClaims, Variables } from "./auth.middleware";
import { bearerToken, type TokenExtractor } from "./token-source";

/**
 * Kimlik doğrulama FABRİKASI — core'un asıl formu.
 *
 * Modül düzeyi `setTokenVerifier` + `authMiddleware` ikilisi (bkz.
 * `auth.middleware.ts`) bunun süreç-genelinde tek bir örneğidir ve geriye uyum
 * için korunur. Fabrika formu üç şeyi mümkün kılar:
 *
 *   1. Token kaynağını değiştirmek (çerez, özel başlık) — `extract`.
 *   2. Aynı süreçte birden çok yapılandırma (ör. panel + genel API, ya da
 *      testlerde izole app örnekleri).
 *   3. Global duruma dokunmayan testler.
 */

/** Ham token'ı doğrular; geçersizse `null`. */
export type TokenVerifier = (token: string) => Promise<AuthClaims | null>;

export interface CreateAuthOptions {
  verify: TokenVerifier;
  /** Token'ın nereden okunacağı. Varsayılan `Authorization: Bearer`. */
  extract?: TokenExtractor;
}

export interface Auth {
  /** `user` context değişkenini kuran middleware. */
  middleware: MiddlewareHandler<{ Variables: Variables }>;
}

export function createAuth({ verify, extract = bearerToken }: CreateAuthOptions): Auth {
  const middleware = async (c: Context<{ Variables: Variables }>, next: Next) => {
    const token = extract(c);
    // Dil/zarf burada KURULMAZ: mesaj anahtarı fırlatılır, app.onError tek
    // noktadan 401 + i18n'e çevirir.
    if (!token) throw new UnauthorizedError("auth.tokenMissing");

    const claims = await verify(token);
    if (!claims) throw new UnauthorizedError("auth.tokenInvalid");

    c.set("user", claims);
    await next();
  };

  return { middleware };
}
