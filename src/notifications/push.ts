import webpush from "web-push";
import type { Logger } from "../logger/logger";
import type { PushSubscriptionStore, WebPushPayload, WebPushSubscription } from "./push.types";

/**
 * Taşınabilir Web Push gönderici FABRİKASI. core/ proje-bağımsız kalsın diye VAPID
 * anahtarları ve abonelik deposu DIŞARIDAN enjekte edilir (createMailer / CacheStore
 * ile aynı desen). `web-push` kütüphanesi VAPID imzalama + payload şifrelemeyi yapar
 * (Bun'da node:crypto ile çalışır).
 *
 * WebSocket'in TAMAMLAYICISIDIR: WS yalnızca uygulama AÇIKKEN çalışır; web push,
 * uygulama KAPALIYKEN de cihaza (SW → OS bildirimi) ulaşır. İkili teslimatta
 * çift-bildirimi ÖNLEMEK service worker'ın işidir (bkz. `docs/BILDIRIMLER.md`):
 * push geldiğinde odaklı bir pencere varsa OS bildirimini bastırır, `tag` ile de-dup eder.
 */
export interface VapidConfig {
  /** `mailto:` veya `https:` — push servisine uygulama kimliğini bildirir. */
  subject: string;
  publicKey: string;
  privateKey: string;
}

export interface CreateWebPushSenderOptions {
  vapid: VapidConfig;
  store: PushSubscriptionStore;
  logger?: Logger;
  /**
   * Push servisinin bildirimi kaç saniye saklayacağı (cihaz çevrimdışıysa). Süre
   * dolarsa teslim edilmez. Varsayılan 86400 (1 gün).
   */
  ttlSeconds?: number;
}

export interface SendResult {
  /** Push servisine başarıyla iletilen abonelik sayısı. */
  sent: number;
  /** İptal edildiği için (404/410) silinen ölü abonelik sayısı. */
  pruned: number;
}

export interface WebPushSender {
  /** Bir özneyi tüm cihazlarına bildirir; ölü abonelikleri otomatik temizler. */
  sendToUser(subjectId: string, payload: WebPushPayload): Promise<SendResult>;
  /** İstemcinin `pushManager.subscribe` için ihtiyaç duyduğu VAPID public anahtarı. */
  readonly publicKey: string;
}

/** Abonelik artık geçersiz: push servisi bu kodlarda cihazın kaydını silmiştir. */
const GONE_STATUS = new Set([404, 410]);

export function createWebPushSender(options: CreateWebPushSenderOptions): WebPushSender {
  const { vapid, store, logger, ttlSeconds = 86_400 } = options;
  const vapidDetails = {
    subject: vapid.subject,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
  };

  return {
    publicKey: vapid.publicKey,

    async sendToUser(subjectId, payload): Promise<SendResult> {
      const subscriptions = await store.list(subjectId);
      if (subscriptions.length === 0) return { sent: 0, pruned: 0 };

      const body = JSON.stringify(payload);
      const dead: string[] = [];
      let sent = 0;

      // Cihazlar bağımsız; biri başarısız olsa diğerleri denenir (Promise.all + iç catch).
      await Promise.all(
        subscriptions.map(async (subscription: WebPushSubscription) => {
          try {
            await webpush.sendNotification(subscription, body, { vapidDetails, TTL: ttlSeconds });
            sent++;
          } catch (err) {
            const statusCode = (err as { statusCode?: number }).statusCode;
            if (statusCode && GONE_STATUS.has(statusCode)) {
              // Abonelik iptal edilmiş/süresi dolmuş → çöp birikmesin diye topla-sil.
              dead.push(subscription.endpoint);
            } else {
              logger?.warn({ err, endpoint: subscription.endpoint, statusCode }, "web push delivery failed");
            }
          }
        })
      );

      if (dead.length > 0) {
        await store
          .removeByEndpoints(dead)
          .catch((err) => logger?.warn({ err, count: dead.length }, "failed to prune dead push subscriptions"));
      }

      return { sent, pruned: dead.length };
    },
  };
}
