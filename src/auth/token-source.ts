import { getCookie } from "hono/cookie";
import type { Context } from "hono";

/**
 * Token'ın istekten NEREDEN okunacağı. Core bir varsayılan sunar (`Authorization:
 * Bearer`) ama dayatmaz: panel oturumunu çerezle taşıyan bir proje, çekirdeği
 * değiştirmeden kendi kaynağını enjekte edebilmelidir.
 *
 * Bu dikiş olmadığı için tüketiciler `authMiddleware`'in tamamını yeniden
 * yazmak zorunda kalıyordu — mekanizma aynıyken yalnızca okuma noktası farklı
 * olduğu hâlde.
 */
export type TokenExtractor = (c: Context) => string | undefined;

const AUTHORIZATION_HEADER = "Authorization";
const BEARER_SCHEME = "Bearer ";

/** `Authorization: Bearer <token>` — varsayılan kaynak. */
export const bearerToken: TokenExtractor = (c) => {
  const header = c.req.header(AUTHORIZATION_HEADER);
  if (!header?.startsWith(BEARER_SCHEME)) return undefined;
  return header.slice(BEARER_SCHEME.length) || undefined;
};

/**
 * Adlandırılmış çerezden okur. Çerez YAZMA tarafı bilinçli olarak core'da
 * değildir: `secure`, `sameSite` ve ömür kararları projeye (ve ortamına) aittir.
 */
export const cookieToken =
  (cookieName: string): TokenExtractor =>
  (c) =>
    getCookie(c, cookieName) || undefined;

/**
 * Verilen kaynakları SIRAYLA dener, ilk bulduğunu döndürür.
 *
 * Sıra önemlidir: tarayıcı çerezi otomatik gönderdiği için genelde çerez önce
 * gelir; aksi hâlde elle `Bearer` gönderen eski bir istemci, çerezle açılmış
 * güncel oturumun önüne geçer.
 */
export const firstToken =
  (...extractors: readonly TokenExtractor[]): TokenExtractor =>
  (c) => {
    for (const extract of extractors) {
      const token = extract(c);
      if (token) return token;
    }
    return undefined;
  };
