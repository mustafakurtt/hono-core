import { beforeEach, describe, expect, test } from "bun:test";
import {
  bootstrapPermissions,
  totalChanges,
  type PermissionCatalog,
  type PermissionDefinition,
  type PermissionStore,
  type RoleDefinition,
  type RolePermissionLink,
} from "../src/rbac";

/**
 * Bellek adaptörü — portun tamamını karşılar. Core'un depoya dokunmaması
 * sayesinde bu testler altyapı istemez; gerçek Drizzle adaptörü aynı sözleşmeyi
 * uygular (Liskov).
 *
 * Yazma çağrılarını sayar: senkronun İDEMPOTENT olduğunu "değişiklik yok"
 * raporuyla değil, gerçekten yazmadığıyla doğrulamak için.
 */
function memoryStore() {
  const permissions = new Map<string, PermissionDefinition>();
  const roles = new Map<string, Omit<RoleDefinition, "permissions">>();
  const links = new Set<string>();
  const writes = { savePermission: 0, saveRole: 0, link: 0, unlink: 0 };

  const id = (l: RolePermissionLink) => `${l.role}|${l.permission}`;

  const store: PermissionStore = {
    async listPermissions() {
      return [...permissions.values()];
    },
    async savePermission(permission) {
      writes.savePermission++;
      permissions.set(permission.key, permission);
    },
    async listRoles() {
      return [...roles.values()];
    },
    async saveRole(role) {
      writes.saveRole++;
      roles.set(role.name, role);
    },
    async listRolePermissions() {
      return [...links].map((raw) => {
        const [role, permission] = raw.split("|");
        return { role, permission };
      });
    },
    async linkRolePermission(link) {
      writes.link++;
      links.add(id(link));
    },
    async unlinkRolePermission(link) {
      writes.unlink++;
      links.delete(id(link));
    },
  };

  return { store, permissions, roles, links, writes };
}

const catalog = (roles: RoleDefinition[], permissions: PermissionDefinition[]): PermissionCatalog => ({
  permissions,
  roles,
});

const BASE = catalog(
  [
    { name: "editor", description: "İçerik editörü", permissions: ["post.view", "post.manage"] },
    { name: "viewer", permissions: ["post.view"] },
  ],
  [
    { key: "post.view", description: "Gönderileri görüntüle" },
    { key: "post.manage", description: "Gönderileri yönet" },
  ]
);

describe("bootstrapPermissions", () => {
  let db: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    db = memoryStore();
  });

  test("boş depoya kataloğu kurar", async () => {
    const report = await bootstrapPermissions(BASE, db.store);

    expect(report.permissions.added.sort()).toEqual(["post.manage", "post.view"]);
    expect(report.roles.added.sort()).toEqual(["editor", "viewer"]);
    expect(report.rolePermissions.linked).toHaveLength(3);
    expect(totalChanges(report)).toBe(7);
  });

  test("İDEMPOTENT: ikinci koşu hiçbir şey yazmaz", async () => {
    await bootstrapPermissions(BASE, db.store);
    const yazmalar = { ...db.writes };

    const report = await bootstrapPermissions(BASE, db.store);

    expect(totalChanges(report)).toBe(0);
    // Rapor boş demek yetmez; gerçekten yazmadığını da doğrula.
    expect(db.writes).toEqual(yazmalar);
  });

  test("açıklama değişince GÜNCELLER (onConflictDoNothing tuzağı)", async () => {
    await bootstrapPermissions(BASE, db.store);

    const güncel = catalog(BASE.roles as RoleDefinition[], [
      { key: "post.view", description: "YENİ açıklama" },
      { key: "post.manage", description: "Gönderileri yönet" },
    ]);
    const report = await bootstrapPermissions(güncel, db.store);

    expect(report.permissions.updated).toEqual(["post.view"]);
    expect(db.permissions.get("post.view")?.description).toBe("YENİ açıklama");
  });

  test("rol açıklaması da güncellenir", async () => {
    await bootstrapPermissions(BASE, db.store);

    const report = await bootstrapPermissions(
      catalog(
        [
          { name: "editor", description: "DEĞİŞTİ", permissions: ["post.view", "post.manage"] },
          { name: "viewer", permissions: ["post.view"] },
        ],
        BASE.permissions as PermissionDefinition[]
      ),
      db.store
    );

    expect(report.roles.updated).toEqual(["editor"]);
  });

  test("yeni izin eklenince rol bağı da kurulur (403 hatasının kaynağı)", async () => {
    await bootstrapPermissions(BASE, db.store);

    const genişletilmiş = catalog(
      [
        { name: "editor", description: "İçerik editörü", permissions: ["post.view", "post.manage", "audit.view"] },
        { name: "viewer", permissions: ["post.view"] },
      ],
      [...(BASE.permissions as PermissionDefinition[]), { key: "audit.view", description: "Denetim" }]
    );
    const report = await bootstrapPermissions(genişletilmiş, db.store);

    expect(report.permissions.added).toEqual(["audit.view"]);
    expect(report.rolePermissions.linked).toEqual([{ role: "editor", permission: "audit.view" }]);
  });

  test("paketten çıkan izin bağı KALDIRILIR — yetki gerçekten kaybolur", async () => {
    await bootstrapPermissions(BASE, db.store);

    const daraltılmış = catalog(
      [
        { name: "editor", description: "İçerik editörü", permissions: ["post.view"] },
        { name: "viewer", permissions: ["post.view"] },
      ],
      BASE.permissions as PermissionDefinition[]
    );
    const report = await bootstrapPermissions(daraltılmış, db.store);

    expect(report.rolePermissions.unlinked).toEqual([{ role: "editor", permission: "post.manage" }]);
    expect(db.links.has("editor|post.manage")).toBe(false);
  });

  test("katalogda olmayan izin/rol SİLİNMEZ, raporlanır", async () => {
    await bootstrapPermissions(BASE, db.store);

    const küçültülmüş = catalog(
      [{ name: "viewer", permissions: ["post.view"] }],
      [{ key: "post.view", description: "Gönderileri görüntüle" }]
    );
    const report = await bootstrapPermissions(küçültülmüş, db.store);

    expect(report.permissions.orphaned).toEqual(["post.manage"]);
    expect(report.roles.orphaned).toEqual(["editor"]);
    // Silmek yabancı anahtarları kırabilir; karar operatörün.
    expect(db.permissions.has("post.manage")).toBe(true);
    expect(db.roles.has("editor")).toBe(true);
  });

  test("katalog dışı rolün bağlarına DOKUNULMAZ", async () => {
    await bootstrapPermissions(BASE, db.store);
    // Elle kurulmuş, katalogun yönetmediği bir rol:
    await db.store.linkRolePermission({ role: "elle-kurulan", permission: "post.view" });

    const report = await bootstrapPermissions(BASE, db.store);

    expect(report.rolePermissions.unlinked).toEqual([]);
    expect(db.links.has("elle-kurulan|post.view")).toBe(true);
  });

  test("boş katalog hiçbir şey yapmaz", async () => {
    const report = await bootstrapPermissions({ permissions: [], roles: [] }, db.store);
    expect(totalChanges(report)).toBe(0);
  });

  test("açıklamasız izin, açıklama eklenince güncellenir", async () => {
    const önce = catalog([], [{ key: "x.view" }]);
    await bootstrapPermissions(önce, db.store);

    const sonra = catalog([], [{ key: "x.view", description: "Artık var" }]);
    const report = await bootstrapPermissions(sonra, db.store);

    expect(report.permissions.updated).toEqual(["x.view"]);
  });
});
