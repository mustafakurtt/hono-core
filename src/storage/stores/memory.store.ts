import type { StorageStore, StoredObject } from "../storage.port";

/**
 * Süreç-içi bellek adaptörü — testler ve tek-instance geçici kullanım için (diske
 * yazmaz). Kopya döner ki çağıran döneni değiştirse depo bozulmasın.
 */
export class InMemoryStorage implements StorageStore {
  private readonly objects = new Map<string, StoredObject>();

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType });
  }

  async get(key: string): Promise<StoredObject | null> {
    const obj = this.objects.get(key);
    return obj ? { bytes: new Uint8Array(obj.bytes), contentType: obj.contentType } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
