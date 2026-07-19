/**
 * Nesne depolama (object storage) PORT'u — core'un felsefesi: proje-bağımsız arayüz
 * + değiştirilebilir adaptörler (bkz. CacheStore, BaseRepository). Feature'lar bir
 * somut sürücüye (disk/S3) değil bu sözleşmeye bağımlıdır (DIP).
 *
 * `key` opak, düz bir kimliktir (ör. "a1b2....png"); adaptör onu güvenli bir
 * konuma eşler. İçerik-tipi değerle BİRLİKTE saklanır/döner (adaptör isterse
 * key uzantısından türetebilir, isterse yanında yazabilir). Adaptörler
 * Liskov-substitutable olmalı: aynı sözleşme disk / bellek / S3 için geçerlidir.
 */
export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface StorageStore {
  /** Nesneyi yazar (varsa üzerine yazar). */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;

  /** Nesneyi döner; yoksa `null`. */
  get(key: string): Promise<StoredObject | null>;

  /** Nesneyi siler. Olmayan anahtar sorun değil (idempotent). */
  delete(key: string): Promise<void>;
}
