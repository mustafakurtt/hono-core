import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { StorageStore, StoredObject } from "../storage.port";
import { contentTypeForExtension, extensionOf } from "../mime";

/**
 * Yerel disk adaptörü (self-host varsayılanı). Nesneyi `baseDir/<key>` olarak yazar;
 * içerik-tipini KEY UZANTISINDAN türetir (yan dosya tutmaz — key'ler zaten
 * "<uuid>.<ext>" biçiminde üretilir).
 *
 * GÜVENLİK: `key` yalnızca güvenli bir dosya adı olabilir (path traversal'a karşı):
 * çözülen mutlak yol baseDir'in ALTINDA kalmalı; aksi halde reddedilir. Çağıran
 * katman (media feature) zaten rastgele uuid + beyaz-liste uzantı üretir; bu ikinci
 * savunma hattıdır.
 */
export class LocalDiskStorage implements StorageStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
  }

  private safePath(key: string): string {
    const full = resolve(this.baseDir, key);
    // baseDir'in dışına çıkan bir yol (../ vb.) reddedilir.
    if (full !== this.baseDir && !full.startsWith(this.baseDir + sep)) {
      throw new Error(`LocalDiskStorage: güvensiz key reddedildi: ${key}`);
    }
    return full;
  }

  async put(key: string, bytes: Uint8Array, _contentType: string): Promise<void> {
    const full = this.safePath(key);
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(full, bytes);
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const bytes = await readFile(this.safePath(key));
      return { bytes: new Uint8Array(bytes), contentType: contentTypeForExtension(extensionOf(key)) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.safePath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
