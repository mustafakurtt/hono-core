import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { setTokenVerifier, type AuthClaims } from "../src/auth";
import {
  configureRbac,
  configureTenantScope,
  guard,
  guardRole,
  setGuardAuditSink,
  type AuthzContext,
} from "../src/rbac";
import { createErrorHandler } from "../src/http";
import { createLogger, LogLevel } from "../src/logger";

/**
 * Bu dosya core'un TAŞINABİLİRLİK sözleşmesini doğrular: core hiçbir proje alanını
 * (userId/tenantId) veya rol adını İSMEN bilmemeli — hepsi dikişlerden gelmeli.
 * Burada kasıtlı olarak uniclub'ınkinden FARKLI adlar kullanıyoruz (subject/orgId,
 * "root" rolü) — core bunlara da aynı şekilde uymalı.
 */
declare module "../src/auth/auth.middleware" {
  interface AuthClaims {
    subject: string;
    orgId: string | null;
  }
}

const silentLogger = createLogger({ level: LogLevel.Silent });

/** Sahte kullanıcı kataloğu: token = kullanıcı adı. */
const users: Record<string, { claims: AuthClaims; authz: AuthzContext }> = {
  ada: {
    claims: { subject: "ada", orgId: "org-1" },
    authz: { roles: ["editor"], permissions: ["post.view", "post.manage"] },
  },
  bob: {
    claims: { subject: "bob", orgId: "org-2" },
    authz: { roles: ["viewer"], permissions: ["post.view"] },
  },
  root: {
    claims: { subject: "root", orgId: null },
    authz: { roles: ["root"], permissions: ["post.view", "post.manage"] },
  },
  askida: {
    claims: { subject: "askida", orgId: "org-1" },
    authz: { roles: ["editor"], permissions: ["post.manage"] },
  },
};

const buildApp = () => {
  const app = new Hono();
  app.onError(
    createErrorHandler({
      logger: silentLogger,
      fallbackMessage: "server.unexpected",
      getRequestId: () => "req-1",
    })
  );
  return app;
};

const as = (user: string) => ({ headers: { Authorization: `Bearer ${user}` } });

beforeEach(() => {
  setTokenVerifier(async (token) => users[token]?.claims ?? null);
  configureRbac({
    getSubjectId: (user) => user.subject,
    resolveAuthz: async (id) => users[id]!.authz,
  });
  configureTenantScope({
    getTenantId: (user) => user.orgId,
    paramName: "orgId",
    bypassRoles: ["root"],
  });
  setGuardAuditSink(() => {});
});

describe("guard — izin tabanlı", () => {
  const app = buildApp();
  app.get("/posts", ...guard("post.view"), (c) => c.json({ ok: true }));
  app.post("/posts", ...guard("post.manage"), (c) => c.json({ ok: true }));

  test("izni olan geçer", async () => {
    expect((await app.request("/posts", as("ada"))).status).toBe(200);
  });

  test("izni olmayan 403", async () => {
    const res = await app.request("/posts", { method: "POST", ...as("bob") });
    expect(res.status).toBe(403);
    expect((await res.json() as { message: string }).message).toBe("rbac.forbidden");
  });

  test("token yoksa 401", async () => {
    const res = await app.request("/posts");
    expect(res.status).toBe(401);
    expect((await res.json() as { message: string }).message).toBe("auth.tokenMissing");
  });

  test("token geçersizse 401", async () => {
    const res = await app.request("/posts", as("kimse-yok"));
    expect(res.status).toBe(401);
    expect((await res.json() as { message: string }).message).toBe("auth.tokenInvalid");
  });
});

describe("guardRole — rol tabanlı (izin kataloğu kurmayan projeler)", () => {
  const app = buildApp();
  app.get("/admin", ...guardRole("root"), (c) => c.json({ ok: true }));

  test("rolü olan geçer", async () => {
    expect((await app.request("/admin", as("root"))).status).toBe(200);
  });

  test("rolü olmayan 403", async () => {
    expect((await app.request("/admin", as("ada"))).status).toBe(403);
  });
});

describe("enforce hook — proje politikası (ör. askıya alma)", () => {
  test("enforce fırlatırsa istek kesilir", async () => {
    configureRbac({
      getSubjectId: (user) => user.subject,
      resolveAuthz: async (id) => users[id]!.authz,
      enforce: (authz) => {
        // "suspended" kavramı PROJEDE; core bilmiyor.
        if (authz.roles.includes("editor") && !authz.permissions.includes("post.view")) {
          throw new Error("askıya alınmış");
        }
      },
    });

    const app = buildApp();
    app.post("/posts", ...guard("post.manage"), (c) => c.json({ ok: true }));

    // askida: post.manage izni VAR ama enforce onu keser → izin kontrolüne bile gelmez.
    expect((await app.request("/posts", { method: "POST", ...as("askida") })).status).toBe(500);
    expect((await app.request("/posts", { method: "POST", ...as("ada") })).status).toBe(200);
  });
});

describe("tenant scope", () => {
  const app = buildApp();
  app.get("/orgs/:orgId/posts", ...guard("post.view", { tenantScoped: true }), (c) =>
    c.json({ scope: c.get("scopeTenantId") })
  );

  test("kendi tenant'ına erişebilir", async () => {
    const res = await app.request("/orgs/org-1/posts", as("ada"));
    expect(res.status).toBe(200);
    expect((await res.json() as { scope: string }).scope).toBe("org-1");
  });

  test("başka tenant'a erişemez", async () => {
    const res = await app.request("/orgs/org-2/posts", as("ada"));
    expect(res.status).toBe(403);
    expect((await res.json() as { message: string }).message).toBe("rbac.tenantForbidden");
  });

  test("bypass rolü her tenant'a erişir", async () => {
    const res = await app.request("/orgs/org-9/posts", as("root"));
    expect(res.status).toBe(200);
    expect((await res.json() as { scope: string }).scope).toBe("org-9");
  });

  test("tenant'ı olmayan ve bypass'ı da olmayan reddedilir", async () => {
    configureTenantScope({
      getTenantId: (user) => user.orgId,
      paramName: "orgId",
      bypassRoles: [], // root'un bypass'ı yok artık
    });
    expect((await app.request("/orgs/org-9/posts", as("root"))).status).toBe(403);
  });
});

describe("audit hook", () => {
  test("mutasyonlar sink'e düşer, GET'ler düşmez", async () => {
    const kayitlar: Array<{ key: string; status: number }> = [];
    setGuardAuditSink((c, key) => {
      kayitlar.push({ key, status: c.res.status });
    });

    const app = buildApp();
    app.get("/posts", ...guard("post.view"), (c) => c.json({ ok: true }));
    app.post("/posts", ...guard("post.manage"), (c) => c.json({ ok: true }));

    await app.request("/posts", as("ada"));
    await app.request("/posts", { method: "POST", ...as("ada") });

    expect(kayitlar).toEqual([{ key: "post.manage", status: 200 }]);
  });

  test("REDDEDİLEN deneme de (403) denetim izine düşer", async () => {
    const kayitlar: Array<{ key: string; status: number }> = [];
    setGuardAuditSink((c, key) => {
      kayitlar.push({ key, status: c.res.status });
    });

    const app = buildApp();
    app.post("/posts", ...guard("post.manage"), (c) => c.json({ ok: true }));
    await app.request("/posts", { method: "POST", ...as("bob") });

    expect(kayitlar).toEqual([{ key: "post.manage", status: 403 }]);
  });

  test("sink hatası isteği ASLA düşürmez", async () => {
    setGuardAuditSink(() => {
      throw new Error("audit DB down");
    });

    const app = buildApp();
    app.post("/posts", ...guard("post.manage"), (c) => c.json({ ok: true }));

    expect((await app.request("/posts", { method: "POST", ...as("ada") })).status).toBe(200);
  });
});
