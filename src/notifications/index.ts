/**
 * core/notifications barrel — taşınabilir Web Push altyapısı (W3C Push + VAPID).
 * WebSocket'in tamamlayıcısı: uygulama kapalıyken de teslimat. Proje kurulumu
 * (VAPID env + Drizzle store) buradan tek noktadan import eder.
 */
export { createWebPushSender } from "./push";
export type {
  WebPushSender,
  VapidConfig,
  CreateWebPushSenderOptions,
  SendResult,
} from "./push";
export type { WebPushSubscription, WebPushPayload, PushSubscriptionStore } from "./push.types";
