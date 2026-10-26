/**
 * Sunucu yalnızca bilinen push servislerine istek atmalı. Aksi hâlde bir kullanıcı "bildirim adresi"
 * olarak iç ağdaki bir adresi (ör. http://postgres) kaydedip API'ye istek attırabilir (SSRF).
 *
 * Mekanizma burada, liste kararı çağıranda: `hosts` bilinçli olarak ZORUNLUDUR. Hazır liste
 * (`BROWSER_PUSH_SERVICE_HOSTS`) tarayıcıların bugün kullandığı servislerdir; yeni bir tarayıcı başka
 * servis kullanırsa proje kendi listesini genişletir.
 */
export const BROWSER_PUSH_SERVICE_HOSTS: readonly RegExp[] = [
  /^web\.push\.apple\.com$/, // Safari (iPhone, iPad, Mac)
  /^fcm\.googleapis\.com$/, // Chrome, Edge (Android), Samsung, Opera
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge (Windows)
];

/** `https:`, varsayılan port ve `hosts`'tan biriyle eşleşen ana makine; geçersiz URL `false` döner. */
export function isPushServiceEndpoint(endpoint: string, hosts: readonly RegExp[]): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && url.port === "" && hosts.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}
