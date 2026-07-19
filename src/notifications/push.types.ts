/**
 * Web Push (W3C Push API + VAPID) taşınabilir sözleşmesi. core/ proje-bağımsız
 * kalsın diye abonelik DEPOLAMASI dışarıdan verilir (port) — proje Drizzle ile kurar.
 */

/** Tarayıcının `PushSubscription.toJSON()` çıktısıyla birebir. */
export interface WebPushSubscription {
  /** Tarayıcının push servisi URL'i — cihazın benzersiz kimliği. */
  endpoint: string;
  keys: {
    /** İstemci public anahtarı (payload şifreleme). */
    p256dh: string;
    /** İstemci auth secret'ı. */
    auth: string;
  };
}

/**
 * Bir cihaza gidecek push yükü. KÜÇÜK tutulur: push servisleri boyutu sınırlar
 * (~4KB) ve amaç "uyandır + minimal veri"dir — SW gerekirse detayı API'den çeker.
 */
export interface WebPushPayload {
  title: string;
  body?: string;
  /**
   * Aynı `tag`'li bildirimler istemcide çakışır (üst üste binmez). WebSocket ile
   * aynı bildirimin iki kez gösterilmemesi için genelde bildirim id'si verilir.
   */
  tag?: string;
  /** Derin link / SW'nin kullanacağı serbest veri. */
  data?: Record<string, unknown>;
}

/**
 * Abonelik deposu PORT'u (storage-agnostik). Adaptör Liskov-substitutable olmalı:
 * aynı sözleşme Drizzle / bellek / test sahtesi için de geçerlidir.
 */
export interface PushSubscriptionStore {
  /** Bir özneye ait tüm abonelikler (aynı anda açık tüm cihazlar). */
  list(subjectId: string): Promise<WebPushSubscription[]>;
  /**
   * Aboneliği kaydeder/tazeler. `endpoint`'e göre UPSERT olmalı: aynı cihaz iki kez
   * abone olunca çift kayıt oluşmasın (anahtarlar dönebileceği için güncellenir).
   */
  save(subjectId: string, subscription: WebPushSubscription): Promise<void>;
  /**
   * Verilen endpoint'lere ait abonelikleri siler. İki yerde kullanılır: kullanıcı
   * çıkışı (unsubscribe) ve push servisi 404/410 dönünce ölü abonelik temizliği.
   */
  removeByEndpoints(endpoints: string[]): Promise<void>;
}
