import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { pgTable, text } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { BaseRepository, softDeleteColumn, timestamps, uuidPrimaryKey, type Database } from "../src/db";

/**
 * core/db GERÇEK bir Postgres ister (core'un tek altyapı-bağımlı testi).
 *   docker compose up -d
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5433/hono_core_test bun test
 *
 * DATABASE_URL yoksa bu dosya ATLANIR — diğer testler altyapısız koşmaya devam eder.
 */
const DATABASE_URL = process.env.DATABASE_URL;

// Tablo, core'un base.entity yardımcılarıyla kuruluyor — onlar da böylece test ediliyor.
const items = pgTable("items", {
  id: uuidPrimaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  ...timestamps,
  ...softDeleteColumn,
});

describe.skipIf(!DATABASE_URL)("core/db — BaseRepository", () => {
  const sql = postgres(DATABASE_URL!, { max: 4 });
  const db = drizzle({ client: sql }) as unknown as Database;

  const repo = new BaseRepository(db, items);
  const softRepo = new BaseRepository(db, items, { softDelete: true });

  afterAll(async () => {
    await sql`drop table if exists items`;
    await sql.end();
  });

  beforeEach(async () => {
    await sql`drop table if exists items`;
    await sql`
      create table items (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        kind text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz
      )
    `;
  });

  describe("CRUD", () => {
    test("create → findById turu", async () => {
      const olusan = await repo.create({ name: "A", kind: "x" });

      expect(olusan.id).toBeString();
      expect((await repo.findById(olusan.id))?.name).toBe("A");
    });

    test("createMany ve count", async () => {
      await repo.createMany([
        { name: "A", kind: "x" },
        { name: "B", kind: "y" },
      ]);
      expect(await repo.count()).toBe(2);
    });

    test("createMany boş dizide no-op", async () => {
      expect(await repo.createMany([])).toEqual([]);
      expect(await repo.count()).toBe(0);
    });

    test("updateById değişikliği döner", async () => {
      const { id } = await repo.create({ name: "A", kind: "x" });
      expect((await repo.updateById(id, { name: "A2" }))?.name).toBe("A2");
    });

    test("olmayan id'de update/delete güvenli davranır", async () => {
      const yok = "00000000-0000-0000-0000-000000000000";
      expect(await repo.updateById(yok, { name: "z" })).toBeUndefined();
      expect(await repo.deleteById(yok)).toBe(false);
      expect(await repo.existsById(yok)).toBe(false);
    });

    test("findAll limit/offset", async () => {
      await repo.createMany([
        { name: "A", kind: "x" },
        { name: "B", kind: "x" },
        { name: "C", kind: "x" },
      ]);
      expect(await repo.findAll({ limit: 2 })).toHaveLength(2);
      expect(await repo.findAll({ limit: 2, offset: 2 })).toHaveLength(1);
    });
  });

  describe("composite-where", () => {
    test("findOne / findMany / existsWhere", async () => {
      await repo.createMany([
        { name: "A", kind: "x" },
        { name: "B", kind: "x" },
        { name: "C", kind: "y" },
      ]);

      expect((await repo.findOne({ name: "B", kind: "x" }))?.name).toBe("B");
      expect(await repo.findMany({ kind: "x" })).toHaveLength(2);
      expect(await repo.existsWhere({ kind: "y" })).toBe(true);
      expect(await repo.existsWhere({ kind: "zzz" })).toBe(false);
    });

    test("null değer IS NULL'a çevrilir", async () => {
      await repo.create({ name: "A", kind: "x" });
      expect(await repo.findMany({ deletedAt: null })).toHaveLength(1);
    });

    test("GÜVENLİK: undefined değer FIRLATIR (sessizce tüm tabloyu hedeflemez)", () => {
      expect(repo.findOne({ name: undefined })).rejects.toThrow(/undefined/);
    });

    test("GÜVENLİK: olmayan kolon adı FIRLATIR", () => {
      expect(repo.findOne({ yokBoyleKolon: "x" } as never)).rejects.toThrow(/kolon değil/);
    });

    test("GÜVENLİK: boş filtreyle toplu yazma ENGELLENİR", async () => {
      await repo.create({ name: "A", kind: "x" });

      expect(repo.updateWhere({}, { name: "hepsi" })).rejects.toThrow(/boş filtreyle/);
      expect(repo.deleteWhere({})).rejects.toThrow(/boş filtreyle/);
      // Kayıt hâlâ duruyor olmalı.
      expect(await repo.count()).toBe(1);
    });

    test("updateWhere / deleteWhere yalnızca eşleşenleri etkiler", async () => {
      await repo.createMany([
        { name: "A", kind: "x" },
        { name: "B", kind: "x" },
        { name: "C", kind: "y" },
      ]);

      expect(await repo.updateWhere({ kind: "x" }, { name: "Z" })).toHaveLength(2);
      expect(await repo.deleteWhere({ kind: "y" })).toBe(1);
      expect(await repo.count()).toBe(2);
    });
  });

  describe("soft delete", () => {
    test("deleteById yumuşak siler; okumalar hariç tutar", async () => {
      const { id } = await softRepo.create({ name: "A", kind: "x" });
      expect(await softRepo.deleteById(id)).toBe(true);

      expect(await softRepo.findById(id)).toBeUndefined();
      expect(await softRepo.count()).toBe(0);
      expect(await softRepo.existsById(id)).toBe(false);

      // Satır fiziksel olarak DURUYOR.
      expect(await softRepo.findById(id, { withDeleted: true })).toBeDefined();
      expect(await softRepo.count({ withDeleted: true })).toBe(1);
    });

    test("restoreById geri getirir", async () => {
      const { id } = await softRepo.create({ name: "A", kind: "x" });
      await softRepo.deleteById(id);
      await softRepo.restoreById(id);

      expect(await softRepo.findById(id)).toBeDefined();
    });

    test("hardDeleteById softDelete'e rağmen fiziksel siler", async () => {
      const { id } = await softRepo.create({ name: "A", kind: "x" });
      await softRepo.hardDeleteById(id);

      expect(await softRepo.findById(id, { withDeleted: true })).toBeUndefined();
    });

    test("softDelete kapalıyken restoreById FIRLATIR", () => {
      expect(repo.restoreById("00000000-0000-0000-0000-000000000000")).rejects.toThrow(
        /softDelete=true/
      );
    });

    test("deletedAt kolonu olmayan tabloda softDelete:true kurulum anında FIRLATIR", () => {
      const kolonsuz = pgTable("kolonsuz", { id: uuidPrimaryKey(), name: text("name").notNull() });
      expect(() => new BaseRepository(db, kolonsuz, { softDelete: true })).toThrow(/deletedAt/);
    });
  });

  describe("transaction", () => {
    test("başarılı akış COMMIT eder", async () => {
      await repo.transaction(async (txRepo) => {
        await txRepo.create({ name: "A", kind: "x" });
        await txRepo.create({ name: "B", kind: "x" });
      });

      expect(await repo.count()).toBe(2);
    });

    test("hata ROLLBACK eder — hiçbir satır kalmaz", async () => {
      const patla = repo.transaction(async (txRepo) => {
        await txRepo.create({ name: "A", kind: "x" });
        throw new Error("iş kuralı patladı");
      });

      expect(patla).rejects.toThrow("iş kuralı patladı");
      await patla.catch(() => {});

      expect(await repo.count()).toBe(0);
    });
  });

  describe("keyset sayfalama", () => {
    test("cursor'dan sonrasını azalan sırada döner, satır atlamaz", async () => {
      // createdAt varsayılanı now() — deterministik olsun diye açıkça veriyoruz.
      const taban = Date.now();
      await repo.createMany(
        [1, 2, 3, 4, 5].map((i) => ({
          name: `N${i}`,
          kind: "x",
          createdAt: new Date(taban + i * 1000),
        })) as never
      );

      const ilkSayfa = await repo.listKeyset({ cursorColumn: items.createdAt, limit: 2 });
      expect(ilkSayfa.map((r) => r.name)).toEqual(["N5", "N4"]);

      const ikinciSayfa = await repo.listKeyset({
        cursorColumn: items.createdAt,
        cursor: ilkSayfa[1].createdAt,
        limit: 2,
      });
      expect(ikinciSayfa.map((r) => r.name)).toEqual(["N3", "N2"]);
    });

    test("where filtresiyle birlikte çalışır", async () => {
      await repo.createMany([
        { name: "A", kind: "x" },
        { name: "B", kind: "y" },
        { name: "C", kind: "x" },
      ]);

      const sayfa = await repo.listKeyset({
        where: { kind: "x" },
        cursorColumn: items.createdAt,
        limit: 10,
      });
      expect(sayfa.every((r) => r.kind === "x")).toBe(true);
      expect(sayfa).toHaveLength(2);
    });
  });

  describe("base.entity", () => {
    test("timestamps varsayılanları dolu gelir", async () => {
      const olusan = await repo.create({ name: "A", kind: "x" });

      expect(olusan.createdAt).toBeInstanceOf(Date);
      expect(olusan.updatedAt).toBeInstanceOf(Date);
      expect(olusan.deletedAt).toBeNull();
    });
  });
});
