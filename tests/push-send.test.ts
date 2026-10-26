import { describe, expect, test } from "bun:test";
import { generateVapidKeys, sendWebPush, type WebPushOptions } from "../src/push";
import { decryptPayload } from "../src/push/testing";

/**
 * v0.7.0'da rfcear/laputa `packages/core/src/push/send.ts`'ten taşındı. "sendWebPush" describe'ı
 * kaynaktaki `send.test.ts`'in birebir kopyasıdır (yalnızca import yolu değişti); doğrulama ve zaman
 * aşımı testleri sonradan eklendi. Gerçek ağ YOK: her test sahte `fetch` kullanır.
 */

const TARGET = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: {
    p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
  },
};

function fakeFetch(status: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("sendWebPush", () => {
  test("RFC 8030 başlıkları ve şifreli gövde", async () => {
    const { fn, calls } = fakeFetch(201);
    const result = await sendWebPush(TARGET, "merhaba", {
      vapid: generateVapidKeys(), subject: "mailto:info@example.com", urgency: "high", topic: "talep", ttlSeconds: 60, fetch: fn,
    });
    expect(result).toEqual({ ok: true, status: 201, gone: false });
    const { url, init } = calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(url).toBe(TARGET.endpoint);
    expect(init.method).toBe("POST");
    expect(headers).toMatchObject({ TTL: "60", Urgency: "high", Topic: "talep", "Content-Encoding": "aes128gcm" });
    expect(headers.Authorization).toStartWith("vapid t=");
    // Düz metin gövdede görünmez.
    expect(Buffer.from(init.body as Uint8Array).includes("merhaba")).toBe(false);
  });

  test("404 ve 410: abonelik bitmiş sayılır; diğer hatalar değil", async () => {
    const vapid = generateVapidKeys();
    for (const [status, gone] of [[404, true], [410, true], [429, false], [500, false]] as const) {
      const result = await sendWebPush(TARGET, "x", { vapid, subject: "mailto:a@b.c", fetch: fakeFetch(status).fn });
      expect(result).toEqual({ ok: false, status, gone });
    }
  });
});

// RFC 8291 Ek A alıcısının gizli anahtarı (TARGET.keys bu çiftin açık yarısı).
const UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
const VAPID = generateVapidKeys();
const base = (fetch: typeof globalThis.fetch): WebPushOptions => ({ vapid: VAPID, subject: "mailto:a@b.c", fetch });

describe("sendWebPush — varsayılanlar ve gövde", () => {
  test("varsayılan TTL 86400, Urgency normal, Topic yok; Authorization ve k= VAPID anahtarı", async () => {
    const { fn, calls } = fakeFetch(201);
    await sendWebPush(TARGET, "x", base(fn));
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.TTL).toBe("86400");
    expect(headers.Urgency).toBe("normal");
    expect(headers.Topic).toBeUndefined();
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${VAPID.publicKey}$`));
  });

  test("TTL 0 geçerlidir (yalnızca çevrimiçi cihaza)", async () => {
    const { fn, calls } = fakeFetch(201);
    await sendWebPush(TARGET, "x", { ...base(fn), ttlSeconds: 0 });
    expect((calls[0]!.init.headers as Record<string, string>).TTL).toBe("0");
  });

  test("gövde alıcıda açılır; Uint8Array içerik de kabul edilir", async () => {
    const { fn, calls } = fakeFetch(201);
    await sendWebPush(TARGET, new TextEncoder().encode("ikili içerik"), base(fn));
    const body = calls[0]!.init.body as Uint8Array;
    expect(decryptPayload(body, UA_PRIVATE, TARGET.keys.auth).toString("utf8")).toBe("ikili içerik");
  });

  test("201 → ok, gone değil", async () => {
    expect(await sendWebPush(TARGET, "x", base(fakeFetch(201).fn))).toEqual({ ok: true, status: 201, gone: false });
  });
});

describe("sendWebPush — doğrulama hatası promise'i reddeder", async () => {
  const { fn, calls } = fakeFetch(201);

  test("geçersiz topic", async () => {
    for (const topic of ["", "a".repeat(33), "boşluk var", "nokta.lı", "türkçe"]) {
      await expect(sendWebPush(TARGET, "x", { ...base(fn), topic })).rejects.toThrow("web push: topic");
    }
    // Sınırdaki geçerli değer gönderilir.
    await expect(sendWebPush(TARGET, "x", { ...base(fn), topic: `${"a".repeat(30)}_-` })).resolves.toMatchObject({ ok: true });
  });

  test("geçersiz TTL", async () => {
    for (const ttlSeconds of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(sendWebPush(TARGET, "x", { ...base(fn), ttlSeconds })).rejects.toThrow("web push: ttlSeconds");
    }
  });

  test("geçersiz timeoutMs", async () => {
    for (const timeoutMs of [0, -5, 2.5, Number.NaN]) {
      await expect(sendWebPush(TARGET, "x", { ...base(fn), timeoutMs })).rejects.toThrow("web push: timeoutMs");
    }
  });

  test("https: olmayan endpoint (kaçış kapısı yok)", async () => {
    for (const endpoint of ["http://fcm.googleapis.com/fcm/send/abc", "ws://localhost/x", "bozuk adres"]) {
      await expect(sendWebPush({ ...TARGET, endpoint }, "x", base(fn))).rejects.toThrow("web push: endpoint");
    }
  });

  test("bozuk abonelik anahtarı, büyük içerik, yanlış subject", async () => {
    await expect(sendWebPush({ ...TARGET, keys: { ...TARGET.keys, p256dh: "AAAA" } }, "x", base(fn))).rejects.toThrow("p256dh");
    await expect(sendWebPush(TARGET, "x".repeat(3994), base(fn))).rejects.toThrow("exceeds");
    await expect(sendWebPush(TARGET, "x", { ...base(fn), subject: "a@b.c" })).rejects.toThrow("subject");
  });

  test("hiçbir doğrulama hatasında istek atılmadı", async () => {
    // Yukarıdaki tek geçerli çağrı (sınırdaki topic) dışında fetch çağrılmadı.
    expect(calls.length).toBe(1);
  });

  test("tek bozuk cihaz yalnızca kendi sonucunu düşürür (allSettled)", async () => {
    const devices = [TARGET, { ...TARGET, keys: { ...TARGET.keys, p256dh: "AAAA" } }, TARGET];
    const results = await Promise.allSettled(devices.map((device) => sendWebPush(device, "x", base(fn))));
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});

describe("sendWebPush — ağ", () => {
  test("zaman aşımı promise'i reddeder", async () => {
    // İsteği asla yanıtlamayan, yalnızca iptal sinyaline uyan sahte istemci.
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const started = Date.now();
    await expect(sendWebPush(TARGET, "x", { ...base(hanging), timeoutMs: 20 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("ağ hatası promise'i reddeder", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(sendWebPush(TARGET, "x", base(failing))).rejects.toThrow("fetch failed");
  });
});
