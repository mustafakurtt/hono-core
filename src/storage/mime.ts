/**
 * Küçük, bağımlılıksız MIME yardımcıları — core storage adaptörleri (uzantı ↔
 * içerik-tipi) ve media feature (beyaz-liste doğrulama) için ortak. Bilinçli olarak
 * yalnızca DESTEKLENEN raster görsel tiplerini bilir; SVG kasıtlı DIŞARIDA (XSS
 * riski — script gömülebilir).
 */
export const IMAGE_MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** "a1b2.png" → "png" (küçük harf, noktadan sonrası). Uzantı yoksa boş string. */
export function extensionOf(key: string): string {
  const dot = key.lastIndexOf(".");
  return dot >= 0 ? key.slice(dot + 1).toLowerCase() : "";
}

/** Uzantıdan içerik-tipi; bilinmiyorsa genel ikili tip. */
export function contentTypeForExtension(ext: string): string {
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

/**
 * İçeriğin İLK baytlarından (magic number) gerçek görsel tipini tespit eder.
 * Beyan edilen Content-Type'a GÜVENMEZ (kılık değiştirmiş dosyaya karşı). Tanınmazsa
 * `null` — çağıran reddeder.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  // PNG: 89 50 4E 47
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: "GIF8"
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  // WEBP: "RIFF"...."WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
