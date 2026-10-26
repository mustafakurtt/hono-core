import { describe, expect, test } from "bun:test";
import { BROWSER_PUSH_SERVICE_HOSTS, isPushServiceEndpoint } from "../src/push";

/**
 * v0.7.0'da rfcear `apps/api/src/features/push/push.policy.ts`'ten (`isAllowedEndpoint` +
 * `PUSH_SERVICE_HOSTS`) taşındı. SSRF örnekleri rfcear `apps/api/test/push.test.ts`'ten birebir.
 */

const allowed = (endpoint: string) => isPushServiceEndpoint(endpoint, BROWSER_PUSH_SERVICE_HOSTS);

describe("isPushServiceEndpoint", () => {
  test("rfcear SSRF örnekleri reddedilir (iç ağa istek attırılamaz)", () => {
    for (const endpoint of ["http://fcm.googleapis.com/x", "https://postgres/x", "https://fcm.googleapis.com:8443/x", "https://evil.example.com/x"]) {
      expect(allowed(endpoint)).toBe(false);
    }
  });

  test("gerçek tarayıcı push servisleri kabul edilir", () => {
    for (const endpoint of [
      "https://web.push.apple.com/QGuQyavXutnMH8sVNSLVQJ8XE0sS",
      "https://fcm.googleapis.com/fcm/send/dXJ2Y2hhbmdl:APA91bH",
      "https://fcm.googleapis.com/wp/dXJ2Y2hhbmdl",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB",
      // Açık yazılmış varsayılan port URL tarafından düşürülür.
      "https://web.push.apple.com:443/abc",
    ]) {
      expect(allowed(endpoint)).toBe(true);
    }
  });

  test("benzer görünen ama farklı ana makineler reddedilir", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilfcm.googleapis.com/x",
      "https://web.push.apple.com@evil.example/x",
      "https://a.b.notify.windows.com/x",
      "https://notify.windows.com/x",
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "bozuk adres",
      "",
    ]) {
      expect(allowed(endpoint)).toBe(false);
    }
  });

  test("liste rfcear push.policy.ts ile birebir aynı", () => {
    expect(BROWSER_PUSH_SERVICE_HOSTS.map(String)).toEqual([
      String(/^web\.push\.apple\.com$/),
      String(/^fcm\.googleapis\.com$/),
      String(/^updates\.push\.services\.mozilla\.com$/),
      String(/^[a-z0-9-]+\.notify\.windows\.com$/),
    ]);
  });

  test("hosts zorunlu: tipte zorunlu, verilmezse ya da boşsa hiçbir adres geçmez", () => {
    // @ts-expect-error — `hosts` bilinçli olarak varsayılansızdır; liste kararı çağıranındır.
    expect(isPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/abc", [])).toBe(false);
  });

  test("proje kendi listesini verebilir; https ve port kuralları yine uygulanır", () => {
    const hosts = [/^push\.example\.com$/];
    expect(isPushServiceEndpoint("https://push.example.com/x", hosts)).toBe(true);
    expect(isPushServiceEndpoint("http://push.example.com/x", hosts)).toBe(false);
    expect(isPushServiceEndpoint("https://push.example.com:8443/x", hosts)).toBe(false);
    expect(isPushServiceEndpoint("https://fcm.googleapis.com/x", hosts)).toBe(false);
  });
});
