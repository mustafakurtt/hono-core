/**
 * `web-push` yalnızca birlikte çalışabilirlik testi için dev bağımlılığıdır (`tests/push-interop.test.ts`).
 * `@types/web-push` paketi kaldırıldı; testin kullandığı genel API'nin asgari tipi burada.
 */
declare module "web-push" {
  interface VapidKeys {
    publicKey: string;
    privateKey: string;
  }

  interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }

  interface RequestOptions {
    vapidDetails?: { subject: string; publicKey: string; privateKey: string };
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    topic?: string;
    contentEncoding?: "aes128gcm" | "aesgcm";
  }

  interface RequestDetails {
    method: string;
    endpoint: string;
    headers: Record<string, string | number>;
    body: Buffer | null;
  }

  const webpush: {
    generateVAPIDKeys(): VapidKeys;
    generateRequestDetails(subscription: PushSubscription, payload?: string | Buffer | null, options?: RequestOptions): RequestDetails;
  };
  export default webpush;
}
