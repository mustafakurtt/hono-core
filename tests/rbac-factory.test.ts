import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createAuth, cookieToken, firstToken, type AuthClaims } from "../src/auth";
import { createRbac, isMutation, type AuthzContext, type GuardStep } from "../src/rbac";
import { createErrorHandler, UnauthorizedError } from "../src/http";
import { createLogger, LogLevel } from "../src/logger";

/**
 * Fabrika formunun sözleşmesi. Süreç durumu TUTMAZ: her test kendi örneğini
 * kurar, `configureRbac`/`setTokenVerifier` gibi global dikişlere dokunmaz —
 * testlerin birbirine sızmaması bu formun asıl gerekçelerinden biri.
 *
 * Proje adları kasıtlı olarak farklı (subject/tenant, "root"): core bunları
 * İSMEN bilmemeli.
 */
declare module "../src/auth/auth.middleware" {
  interface AuthClaims {
    subject: string;
    sessionVersion?: number;
  }
}

const silentLogger = createLogger({ level: LogLevel.Silent });

const AUTHZ: Record<string, AuthzContext> = {
  ada: { roles: ["editor"], permissions: ["post.view", "post.manage"] },
  bob: { roles: ["viewer"], permissions: ["post.view"] },
};

/**
 * Token = kullanıcı adı; opsiyonel "#sürüm" eki oturum sürümünü taşır.
 *
 * `orgId`: `AuthClaims` tüm test dosyalarında ORTAK olarak augment edilir
 * (bkz. rbac.test.ts) — bu dosya tenant kullanmaz ama alanı doldurmak zorundadır.
 */
const verify = async (token: string): Promise<AuthClaims | null> => {
  const [subject, version] = token.split("#");
  if (!AUTHZ[subject]) return null;
  return { subject, orgId: null, sessionVersion: version ? Number(version) : 1 };
};

type PermissionKey = "post.view" | "post.manage";

interface BuildOptions {
  steps?: readonly GuardStep[];
  enforce?: (authz: AuthzContext, user: AuthClaims) => void;
  extractCookie?: string;
  audit?: (key: string, method: string) => void;
  shouldAudit?: (method: string) => boolean;
}

function buildApp(options: BuildOptions = {}) {
  const auth = createAuth({
    verify,
    ...(options.extractCookie
      ? { extract: firstToken(cookieToken(options.extractCookie)) }
      : {}),
  });

  const rbac = createRbac<PermissionKey>({
    auth: auth.middleware,
    getSubjectId: (user) => user.subject,
    resolveAuthz: async (id) => AUTHZ[id],
    enforce: options.enforce,
    steps: options.steps,
    ...(options.audit ? { audit: (c, key) => options.audit!(key, c.req.method) } : {}),
    ...(options.shouldAudit ? { shouldAudit: (c) => options.shouldAudit!(c.req.method) } : {}),
  });

  const app = new Hono();
  app.onError(createErrorHandler({ logger: silentLogger, fallbackMessage: "server.error" }));
  app.get("/posts/:id", ...rbac.guard("post.view"), (c) => c.json({ id: c.req.param("id") }));
  app.post("/posts", ...rbac.guard("post.manage"), (c) => c.json({ ok: true }));
  return app;
}

const asUser = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe("createRbac — kimlik adımı enjekte edilir", () => {
  test("varsayılan Bearer ile çalışır", async () => {
    const res = await buildApp().request("/posts/7", asUser("ada"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "7" });
  });

  test("çerez kaynağı enjekte edilebilir (zincir yeniden yazılmadan)", async () => {
    const app = buildApp({ extractCookie: "oturum" });

    const cookie = await app.request("/posts/7", { headers: { Cookie: "oturum=ada" } });
    expect(cookie.status).toBe(200);

    // Çerez kaynağı seçildiğinde Bearer artık okunmaz.
    expect((await app.request("/posts/7", asUser("ada"))).status).toBe(401);
  });

  test("token yoksa 401", async () => {
    expect((await buildApp().request("/posts/7")).status).toBe(401);
  });
});

describe("createRbac — ek politika adımları (steps)", () => {
  /** Oturum sürümü eskiyse 401: claim'e bakan, authz'a bakmayan bir kontrol. */
  const requireCurrentSession: GuardStep = async (c, next) => {
    const { sessionVersion } = c.get("user");
    if (sessionVersion !== 2) throw new UnauthorizedError("auth.sessionStale");
    await next();
  };

  test("adım zincire girer ve reddedebilir", async () => {
    const app = buildApp({ steps: [requireCurrentSession] });

    expect((await app.request("/posts/7", asUser("ada#1"))).status).toBe(401);
    expect((await app.request("/posts/7", asUser("ada#2"))).status).toBe(200);
  });

  test("adım attachAuthz'dan SONRA çalışır (authz'ı görebilir)", async () => {
    let seenRoles: string[] = [];
    const inspect: GuardStep = async (c, next) => {
      seenRoles = c.get("authz").roles;
      await next();
    };

    await buildApp({ steps: [inspect] }).request("/posts/7", asUser("ada"));
    expect(seenRoles).toEqual(["editor"]);
  });

  test("birden çok adım sırayla çalışır ve tuple uzunluğu değişmez", async () => {
    const order: string[] = [];
    const mark = (name: string): GuardStep => async (_c, next) => {
      order.push(name);
      await next();
    };

    // Path param tipi korunuyorsa zincir hâlâ sabit uzunluktadır.
    const res = await buildApp({ steps: [mark("a"), mark("b"), mark("c")] }).request(
      "/posts/9",
      asUser("ada")
    );

    expect(order).toEqual(["a", "b", "c"]);
    expect(await res.json()).toEqual({ id: "9" });
  });
});

describe("createRbac — enforce claim'leri görür", () => {
  test("enforce'a authz ve user birlikte geçer", async () => {
    const görülen: { roles: string[]; subject: string }[] = [];
    const app = buildApp({
      enforce: (authz, user) => void görülen.push({ roles: authz.roles, subject: user.subject }),
    });

    await app.request("/posts/7", asUser("bob"));
    expect(görülen).toEqual([{ roles: ["viewer"], subject: "bob" }]);
  });

  test("enforce fırlatırsa istek zincirde durur", async () => {
    const app = buildApp({
      enforce: (_authz, user) => {
        if (user.subject === "bob") throw new Error("askıya alınmış");
      },
    });

    expect((await app.request("/posts/7", asUser("bob"))).status).toBe(500);
    expect((await app.request("/posts/7", asUser("ada"))).status).toBe(200);
  });
});

describe("createRbac — yetki kontrolü", () => {
  test("izni olmayan 403 alır", async () => {
    expect((await buildApp().request("/posts", { method: "POST", ...asUser("bob") })).status).toBe(403);
  });

  test("izni olan geçer", async () => {
    expect((await buildApp().request("/posts", { method: "POST", ...asUser("ada") })).status).toBe(200);
  });
});

describe("createRbac — denetim izi", () => {
  test("sink fabrikadan enjekte edilir; global kayda ihtiyaç yok", async () => {
    const kayitlar: string[] = [];
    const app = buildApp({ audit: (key) => void kayitlar.push(key) });

    await app.request("/posts", { method: "POST", ...asUser("ada") });
    expect(kayitlar).toEqual(["post.manage"]);
  });

  test("reddedilen (403) deneme de kaydedilir", async () => {
    const kayitlar: string[] = [];
    const app = buildApp({ audit: (key) => void kayitlar.push(key) });

    const res = await app.request("/posts", { method: "POST", ...asUser("bob") });
    expect(res.status).toBe(403);
    expect(kayitlar).toEqual(["post.manage"]);
  });

  test("varsayılan olarak GET atlanır", async () => {
    const kayitlar: string[] = [];
    await buildApp({ audit: (key) => void kayitlar.push(key) }).request("/posts/7", asUser("ada"));
    expect(kayitlar).toEqual([]);
  });

  test("shouldAudit ile GET de kaydedilebilir (kişisel veri döken uçlar)", async () => {
    const kayitlar: string[] = [];
    const app = buildApp({ audit: (key) => void kayitlar.push(key), shouldAudit: () => true });

    await app.request("/posts/7", asUser("ada"));
    expect(kayitlar).toEqual(["post.view"]);
  });

  test("isMutation varsayılan predikatı dışa açık", () => {
    const asContext = (method: string) => ({ req: { method } }) as never;
    expect(isMutation(asContext("POST"))).toBe(true);
    expect(isMutation(asContext("GET"))).toBe(false);
  });
});

describe("createRbac — tip düzeyi güvenceler", () => {
  test("var olmayan izin anahtarı DERLEME hatasıdır", () => {
    const rbac = createRbac<PermissionKey>({
      auth: createAuth({ verify }).middleware,
      getSubjectId: (user) => user.subject,
      resolveAuthz: async (id) => AUTHZ[id],
    });

    // @ts-expect-error — "yok.olan" PermissionKey union'ında değil.
    rbac.guard("yok.olan");

    // Bu satır derlenmelidir; yukarıdaki @ts-expect-error'un gerçekten bir
    // hatayı bastırdığını da tsc kendisi doğrular (bastıracak hata yoksa uyarır).
    expect(rbac.guard("post.view")).toHaveLength(5);
  });

  test("tenantScope verilince zincir bir adım uzar", () => {
    const rbac = createRbac<PermissionKey>({
      auth: createAuth({ verify }).middleware,
      getSubjectId: (user) => user.subject,
      resolveAuthz: async (id) => AUTHZ[id],
    });

    const passthrough: GuardStep = async (_c, next) => void (await next());
    expect(rbac.guard("post.view", { tenantScope: passthrough })).toHaveLength(6);
  });
});

describe("createRbac — izolasyon", () => {
  test("iki bağımsız örnek aynı süreçte farklı yapılandırmayla çalışır", async () => {
    // Süreç-geneli singleton ile İMKÂNSIZ olan senaryo.
    const panel = buildApp({ extractCookie: "panel" });
    const api = buildApp();

    expect((await panel.request("/posts/1", { headers: { Cookie: "panel=ada" } })).status).toBe(200);
    expect((await api.request("/posts/1", asUser("ada"))).status).toBe(200);
    expect((await panel.request("/posts/1", asUser("ada"))).status).toBe(401);
  });
});
