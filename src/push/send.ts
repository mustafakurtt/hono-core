import { encryptPayload, type PushKeys } from "./encrypt";
import { vapidAuthorization, type VapidKeys } from "./vapid";

/**
 * Tek bir aboneliğe Web Push gönderir (RFC 8030). Kime gönderileceği, ne yazılacağı ve başarısız
 * aboneliğe ne yapılacağı çağıranın kararıdır; burası yalnızca protokoldür.
 *
 * Hangi push servislerine istek atılabileceği de çağıranın kararıdır (SSRF): `isPushServiceEndpoint`
 * ile aboneliği KAYDEDERKEN denetle. Burası yalnızca `https:` olmayan adresi reddeder.
 */
export type PushUrgency = "very-low" | "low" | "normal" | "high";

export interface PushTarget {
  /** Push servisinin adresi; `https:` olmalı (RFC 8030 §8). */
  endpoint: string;
  keys: PushKeys;
}

export interface WebPushOptions {
  vapid: VapidKeys;
  /** VAPID iletişim adresi: `mailto:...` ya da `https:...` */
  subject: string;
  /** Cihaz kapalıyken push servisinin mesajı tutacağı süre (saniye, ≥0 tamsayı). Varsayılan 86400. */
  ttlSeconds?: number;
  /** `high`: telefon uykudaysa da hemen iletilir (pil maliyeti; yalnızca önemli olaylar için). Varsayılan `normal`. */
  urgency?: PushUrgency;
  /** Aynı konudaki bekleyen (henüz iletilmemiş) mesajın yerine geçer. En çok 32 karakter, base64url alfabesi. */
  topic?: string;
  /** İsteğin zaman aşımı (ms, pozitif tamsayı). Varsayılan 10.000. */
  timeoutMs?: number;
  /** Testlerde sahte istemci. */
  fetch?: typeof fetch;
}

export interface WebPushResult {
  ok: boolean;
  status: number;
  /** Abonelik artık yok (404/410): çağıran kaydı silmeli. */
  gone: boolean;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_TIMEOUT_MS = 10_000;
/** RFC 8030 §5.4: en çok 32 karakter, URL ve dosya adı güvenli base64 alfabesi. */
const TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

function assertHttpsEndpoint(endpoint: string): void {
  let protocol: string;
  try {
    protocol = new URL(endpoint).protocol;
  } catch {
    throw new Error("web push: endpoint must be a valid https: URL");
  }
  if (protocol !== "https:") throw new Error("web push: endpoint must be an https: URL");
}

/**
 * Doğrulama hataları (seçenekler, endpoint, anahtarlar, boyut) SENKRON fırlatılır; ağ hatası ve zaman
 * aşımı dönen promise'i reddeder; HTTP hatası `{ ok: false }` olarak döner.
 */
export function sendWebPush(target: PushTarget, payload: string | Uint8Array, options: WebPushOptions): Promise<WebPushResult> {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 0) throw new Error("web push: ttlSeconds must be a non-negative integer");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("web push: timeoutMs must be a positive integer");
  if (options.topic !== undefined && !TOPIC_PATTERN.test(options.topic)) {
    throw new Error("web push: topic must be 1-32 characters of [A-Za-z0-9_-]");
  }
  assertHttpsEndpoint(target.endpoint);

  const plaintext = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const body = encryptPayload(plaintext, target.keys);
  const headers: Record<string, string> = {
    TTL: String(ttlSeconds),
    Urgency: options.urgency ?? "normal",
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    Authorization: vapidAuthorization(target.endpoint, options.vapid, options.subject),
  };
  if (options.topic !== undefined) headers.Topic = options.topic;

  // `Buffer.concat` her zaman yeni (paylaşılmayan) bir ArrayBuffer ayırır; daraltma güvenli.
  return deliver(options.fetch ?? fetch, target.endpoint, headers, body as Uint8Array<ArrayBuffer>, timeoutMs);
}

async function deliver(
  client: typeof fetch,
  endpoint: string,
  headers: Record<string, string>,
  body: Uint8Array<ArrayBuffer>,
  timeoutMs: number
): Promise<WebPushResult> {
  const response = await client(endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
  await response.body?.cancel().catch(() => undefined);
  return { ok: response.ok, status: response.status, gone: response.status === 404 || response.status === 410 };
}
