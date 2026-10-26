/** Yerel kısımdaki noktaların yok sayıldığı sağlayıcılar (aynı kutuya düşer). */
const DOTLESS_DOMAINS = new Set(["gmail.com"]);
/** Aynı sağlayıcının diğer alan adları. */
const DOMAIN_ALIASES: Readonly<Record<string, string>> = { "googlemail.com": "gmail.com" };

/**
 * Aynı posta kutusuna giden adres varyantlarını tek anahtara indirir: küçük
 * harf, `+etiket` atılır, Gmail'de noktalar kaldırılır
 * (`K.Urban+1@googlemail.com` → `kurban@gmail.com`).
 *
 * Yalnızca hız sınırı ve tavan anahtarı içindir (`createRateLimiter`'ın
 * `keyFn`'i): aksi hâlde aynı kutu `+1`, `+2`… ile sınırsız deneme alır.
 * Kayıt ve gönderim, kullanıcının yazdığı adrese yapılmalıdır.
 */
export function emailKey(email: string): string {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 1) return address;

  const rawDomain = address.slice(at + 1);
  const domain = DOMAIN_ALIASES[rawDomain] ?? rawDomain;
  let local = address.slice(0, at).split("+")[0] ?? "";
  if (DOTLESS_DOMAINS.has(domain)) local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}
