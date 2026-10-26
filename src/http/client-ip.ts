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
 *
 * Proxy'nin eklediği port kırpılır (IIS ARR `1.2.3.4:5678`, `[2001:db8::1]:443`):
 * kalırsa her bağlantı ayrı hız sınırı kovasına düşer ve giriş kilidi etkisiz kalır.
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
  /**
   * Ziyaretçinin adresi; bulunamazsa `null`. "Bilinmiyor"un anlamına çağıran
   * karar verir (hız sınırında yedek kova, kayıtta boş alan).
   */
  resolve(c: Context): string | null;
  /** `resolve` ile aynı, bulunamazsa `"unknown"` (log ve denetim alanı için). */
  ip(c: Context): string;
  /** Hız sınırı anahtarı: IPv6 /64'e indirgenmiş adres (bkz. `ipKey`). */
  key(c: Context): string;
}

const UNKNOWN = "unknown";
/** Başlıktan gelen değer için üst sınır: log satırı şişmesin. */
const MAX_ADDRESS_LENGTH = 64;

const BRACKETED = /^\[([^\]]+)\](?::\d+)?$/;
const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;
const HEXTET = /^[0-9a-f]{1,4}$/;
const IPV6_GROUPS = 8;
const PREFIX_GROUPS = 4;

/** Proxy'nin eklediği portu ve köşeli parantezi soyar; çıplak IPv6'ya dokunmaz. */
const stripPort = (address: string): string =>
  BRACKETED.exec(address)?.[1] ?? IPV4_WITH_PORT.exec(address)?.[1] ?? address;

/**
 * Başlık değerinden ziyaretçi adresi (`createClientIp`'in kullandığı kural).
 * Ayrıca dışa açıktır: aynı kuralı başlığı kendisi okuyan katmanlarda (ör. web
 * sunucusu) kopyalamadan kullanmak için.
 */
export function parseForwardedFor(header: string | null | undefined, trustedProxies: number): string | undefined {
  if (trustedProxies <= 0 || !header) return undefined;
  const values = header
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  // Başlıkta beklenenden az değer varsa kenar proxy başlığı baştan yazmıştır:
  // en soldaki değer de güvenilirdir.
  const picked = values[Math.max(0, values.length - trustedProxies)];
  return picked ? stripPort(picked).slice(0, MAX_ADDRESS_LENGTH) : undefined;
}

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

  const resolve = (c: Context): string | null =>
    parseForwardedFor(c.req.header(header), trustedProxies) ?? remoteAddress(c) ?? null;
  const ip = (c: Context): string => resolve(c) ?? UNKNOWN;
  return { resolve, ip, key: (c) => ipKey(ip(c)) };
}

/** "2001:db8::1" → 8 grup (baştaki sıfırlar atılmış); geçersiz biçimde `null`. */
function expandIpv6(address: string): string[] | null {
  const parts = address.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? IPV6_GROUPS - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== IPV6_GROUPS || !groups.every((group) => HEXTET.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16).toString(16));
}

/**
 * Hız sınırı anahtarı. IPv6'da tek adres kimlik değildir: sıradan bir VPS ya
 * da abone bütün bir /64 blok alır ve her istekte başka adres kullanabilir. Bu
 * yüzden IPv6 adresi /64 önekine indirgenir; IPv4'e eşlenmiş IPv6
 * (`::ffff:1.2.3.4`) IPv4 sayılır, port kırpılır. Çözülemeyen biçim olduğu
 * gibi kalır: farklı bozuk adresler tek kovada birleşmesin.
 */
export function ipKey(ip: string): string {
  const address = stripPort(ip).toLowerCase();
  const mapped = IPV4_MAPPED.exec(address);
  if (mapped?.[1]) return mapped[1];
  if (!address.includes(":")) return address;
  const groups = expandIpv6(address.split("%")[0] ?? "");
  return groups ? `${groups.slice(0, PREFIX_GROUPS).join(":")}::/64` : address;
}
