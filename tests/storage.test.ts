import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IMAGE_MIME_TO_EXT,
  InMemoryStorage,
  LocalDiskStorage,
  contentTypeForExtension,
  extensionOf,
  sniffImageMime,
  type StorageStore,
} from "../src/storage";

const tmpRoot = join(tmpdir(), `hono-core-storage-${Date.now()}`);
afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

/**
 * Adaptörler Liskov-substitutable olmalı: AYNI sözleşme testi hem bellek hem disk
 * için koşar. Yeni bir adaptör (S3) eklenince buraya bir satır eklenir.
 */
const adaptorler: Array<[string, () => StorageStore]> = [
  ["InMemoryStorage", () => new InMemoryStorage()],
  ["LocalDiskStorage", () => new LocalDiskStorage(join(tmpRoot, crypto.randomUUID()))],
];

for (const [ad, kur] of adaptorler) {
  describe(`StorageStore sözleşmesi — ${ad}`, () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);

    test("put → get turu bytes ve contentType'ı korur", async () => {
      const store = kur();
      await store.put("a.png", bytes, "image/png");
      const nesne = await store.get("a.png");

      expect(nesne?.contentType).toBe("image/png");
      expect(Array.from(nesne!.bytes)).toEqual([1, 2, 3, 4]);
    });

    test("olmayan anahtar null döner", async () => {
      expect(await kur().get("yok.png")).toBeNull();
    });

    test("put aynı anahtarın üzerine yazar", async () => {
      const store = kur();
      await store.put("a.png", bytes, "image/png");
      await store.put("a.png", new Uint8Array([9]), "image/png");

      expect(Array.from((await store.get("a.png"))!.bytes)).toEqual([9]);
    });

    test("delete siler; olmayanı silmek idempotent", async () => {
      const store = kur();
      await store.put("a.png", bytes, "image/png");
      await store.delete("a.png");

      expect(await store.get("a.png")).toBeNull();
      expect(store.delete("a.png")).resolves.toBeUndefined();
    });
  });
}

describe("mime yardımcıları", () => {
  test("extensionOf anahtardan uzantıyı çıkarır", () => {
    expect(extensionOf("a1b2.png")).toBe("png");
    expect(extensionOf("A1B2.PNG")).toBe("png");
    expect(extensionOf("uzantisiz")).toBe("");
  });

  test("IMAGE_MIME_TO_EXT bilinen MIME'ları eşler", () => {
    expect(IMAGE_MIME_TO_EXT["image/png"]).toBe("png");
    expect(IMAGE_MIME_TO_EXT["image/jpeg"]).toBe("jpg");
    // SVG kasıtlı DIŞARIDA (gömülü script → XSS riski).
    expect(IMAGE_MIME_TO_EXT["image/svg+xml"]).toBeUndefined();
  });

  test("contentTypeForExtension ters yönde çalışır", () => {
    expect(contentTypeForExtension("png")).toBe("image/png");
    expect(contentTypeForExtension("jpeg")).toBe("image/jpeg");
    expect(contentTypeForExtension("bilinmeyen")).toBe("application/octet-stream");
  });

  test("sniffImageMime PNG imzasını byte'lardan tanır", () => {
    // PNG sihirli sayısı: 89 50 4E 47 0D 0A 1A 0A
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(sniffImageMime(png)).toBe("image/png");
  });

  test("sniffImageMime JPEG imzasını tanır", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(sniffImageMime(jpeg)).toBe("image/jpeg");
  });

  test("tanınmayan içerik null döner — uzantıya GÜVENİLMEZ", () => {
    // Saldırgan ".png" adıyla script yükleyebilir; karar içeriğe göre verilmeli.
    expect(sniffImageMime(new Uint8Array([0x3c, 0x3f, 0x70, 0x68, 0x70]))).toBeNull();
  });
});
