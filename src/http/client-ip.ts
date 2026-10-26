import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

/**
 * Ziyaretçi IP'si ve hız sınırı anahtarı.
 *
 * Proxy başlığına (`X-Forwarded-For`) güvenmek bir POLİTİKADIR, core bunu
 * varsayamaz: önünde proxy olmayan bir uygulamada başlığı ziyaretçi yazar ve
 * IP'ye bağlı her sınır tek satırla atlatılır. Bu yüzden `trustedProxies`
 * zorunludur ve varsayılanı yoktur (aynı ilke: `createRateLimiter`'ın `keyFn`'i).
 *
 * Değer SAĞDAN seçilir: başlığa ekleme yapan her güvenilir proxy bir değer
 * ekler, ziyaretçinin gerçek adresi sondan `trustedProxies`'inci değerdir.
 * Solundaki her şey ziyaretçinin uydurabileceği değerlerdir. Kenar proxy
 * başlığı baştan yazıyorsa (Caddy `header_up X-Forwarded-For {client_ip}`)
 * başlıkta tek değer olur ve `trustedProxies: 1` onu seçer.
 */
export interface ClientIpOptions {
  /**
   * Uygulamanın önündeki güvenilir proxy sayısı. `0` → başlık hiç okunmaz,
   * yalnızca bağlantının adresi kullanılır.
   */
  trustedProxies: number;
  /** Okunacak başlık. Varsayılan `x-forwarded-for`. */
  header?: string;
  /**
   * Başlık yoksa kullanılacak bağlantı adresi. Varsayılan Bun sunucusunun
   * bağlantı bilgisi (`hono/bun`); test ya da başka bir çalışma ortamı için
   * değiştirilebilir.
   */
  remoteAddress?: (c: Context) => string | undefined;
}

export interface ClientIp {
  /** Ziyaretçinin tam adresi (log, denetim kaydı). Bulunamazsa `"unknown"`. */
  ip(c: Context): string;
  /** Hız sınırı anahtarı: IPv6 /64'e indirgenmiş adres (bkz. `ipKey`). */
  key(c: Context): string;
}

const UNKNOWN = "unknown";
/** Başlıktan gelen değer için üst sınır: log satırı şişmesin. */
const MAX_ADDRESS_LENGTH = 64;

const bunRemoteAddress = (c: Context): string | undefined => {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    // Bun sunucusu dışında (ör. `app.request` ile test) bağlantı bilgisi yoktur.
    return undefined;
  }
};

export function createClientIp(options: ClientIpOptions): ClientIp {
  const { trustedProxies, header = "x-forwarded-for", remoteAddress = bunRemoteAddress } = options;
  if (!Number.isInteger(trustedProxies) || trustedProxies < 0) {
    throw new Error(`createClientIp: trustedProxies must be a non-negative integer, got ${trustedProxies}`);
  }

  const fromHeader = (c: Context): string | undefined => {
    if (trustedProxies === 0) return undefined;
    const values = (c.req.header(header) ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    // Başlıkta beklenenden az değer varsa kenar proxy başlığı baştan yazmıştır:
    // en soldaki değer de güvenilirdir.
    const picked = values[Math.max(0, values.length - trustedProxies)];
    return picked?.slice(0, MAX_ADDRESS_LENGTH);
  };

  const ip = (c: Context): string => fromHeader(c) ?? remoteAddress(c) ?? UNKNOWN;
  return { ip, key: (c) => ipKey(ip(c)) };
}

/**
 * Hız sınırı anahtarı. IPv6'da tek adres kimlik değildir: sıradan bir VPS ya
 * da abone bütün bir /64 blok alır ve her istekte başka adres kullanabilir. Bu
 * yüzden IPv6 adresi /64 önekine indirgenir; IPv4'e eşlenmiş IPv6
 * (`::ffff:1.2.3.4`) IPv4 sayılır.
 */
export function ipKey(ip: string): string {
  const address = (ip.split("%")[0] ?? "").toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped?.[1]) return mapped[1];
  if (!address.includes(":")) return address;

  const [head = "", tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  const prefix = groups.slice(0, 4).map((group) => (Number.parseInt(group || "0", 16) || 0).toString(16));
  while (prefix.length < 4) prefix.push("0");
  return `${prefix.join(":")}::/64`;
}
