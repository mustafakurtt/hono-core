import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { CompositeKeyRepository, timestamps, type Database } from "../src/db";

/**
 * core/db GERÇEK bir Postgres ister.
 *   docker compose up -d && cp .env.example .env && bun test
 * DATABASE_URL yoksa bu dosya ATLANIR.
 */
const DATABASE_URL = process.env.DATABASE_URL;

/** Çeviri tablosu deseni: (kaynakId, locale) bileşik anahtar — tekil `id` YOK. */
const translations = pgTable(
  "translations",
  {
    postId: uuid("post_id").notNull(),
    locale: text("locale").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (cols) => [primaryKey({ columns: [cols.postId, cols.locale] })]
);

const POST_A = "11111111-1111-1111-1111-111111111111";
const POST_B = "22222222-2222-2222-2222-222222222222";

describe.skipIf(!DATABASE_URL)("core/db — CompositeKeyRepository", () => {
  const sql = postgres(DATABASE_URL!, { max: 4 });
  const db = drizzle({ client: sql }) as unknown as Database;

  const repo = new CompositeKeyRepository(db, translations, {
    keyColumns: ["postId", "locale"],
  });
  const softRepo = new CompositeKeyRepository(db, translations, {
    keyColumns: ["postId", "locale"],
    softDelete: true,
  });

  afterAll(async () => {
    await sql`drop table if exists translations`;
    await sql.end();
  });

  beforeEach(async () => {
    await sql`drop table if exists translations`;
    await sql`
      create table translations (
        post_id uuid not null,
        locale text not null,
        title text not null,
        body text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz,
        primary key (post_id, locale)
      )
    `;
  });

  describe("upsert", () => {
    test("yoksa ekler, varsa GÜNCELLER (onConflictDoNothing tuzağı değil)", async () => {
      await repo.upsert({ postId: POST_A, locale: "tr", title: "Merhaba" });
      const güncel = await repo.upsert({ postId: POST_A, locale: "tr", title: "Selam" });

      expect(güncel.title).toBe("Selam");
      expect(await repo.count()).toBe(1);
    });

    test("aynı kaynağın farklı dilleri ayrı satırlardır", async () => {
      await repo.upsert({ postId: POST_A, locale: "tr", title: "Merhaba" });
      await repo.upsert({ postId: POST_A, locale: "en", title: "Hello" });

      expect(await repo.count()).toBe(2);
      expect((await repo.findByKey({ postId: POST_A, locale: "en" }))?.title).toBe("Hello");
    });

    test("updatedAt çakışma güncellemesinde tazelenir", async () => {
      const ilk = await repo.upsert({ postId: POST_A, locale: "tr", title: "A" });
      await Bun.sleep(15);
      const sonra = await repo.upsert({ postId: POST_A, locale: "tr", title: "B" });

      // Drizzle'ın $onUpdate'i upsert'te çalışmaz; elle tazelenmezse damga eski kalırdı.
      expect(sonra.updatedAt.getTime()).toBeGreaterThan(ilk.updatedAt.getTime());
    });

    test("verilmeyen kolon korunur", async () => {
      await repo.upsert({ postId: POST_A, locale: "tr", title: "A", body: "gövde" });
      const sonra = await repo.upsert({ postId: POST_A, locale: "tr", title: "B" });

      expect(sonra.body).toBe("gövde");
    });

    test("upsertMany toplu çalışır ve her satır KENDİ değerini alır", async () => {
      await repo.upsertMany([
        { postId: POST_A, locale: "tr", title: "eski-A" },
        { postId: POST_B, locale: "tr", title: "eski-B" },
      ]);

      const rows = await repo.upsertMany([
        { postId: POST_A, locale: "tr", title: "yeni-A" },
        { postId: POST_B, locale: "tr", title: "yeni-B" },
      ]);

      expect(rows.map((r) => r.title).sort()).toEqual(["yeni-A", "yeni-B"]);
      expect(await repo.count()).toBe(2);
    });

    test("boş dizi no-op", async () => {
      expect(await repo.upsertMany([])).toEqual([]);
    });
  });

  describe("okuma", () => {
    beforeEach(async () => {
      await repo.upsertMany([
        { postId: POST_A, locale: "tr", title: "A-tr" },
        { postId: POST_A, locale: "en", title: "A-en" },
        { postId: POST_B, locale: "tr", title: "B-tr" },
      ]);
    });

    test("findByKey tam anahtarla tek satır", async () => {
      expect((await repo.findByKey({ postId: POST_A, locale: "tr" }))?.title).toBe("A-tr");
      expect(await repo.findByKey({ postId: POST_B, locale: "en" })).toBeUndefined();
    });

    test("existsByKey", async () => {
      expect(await repo.existsByKey({ postId: POST_A, locale: "en" })).toBe(true);
      expect(await repo.existsByKey({ postId: POST_B, locale: "en" })).toBe(false);
    });

    test("findMany kısmi filtreyle (bir dilin tüm kayıtları)", async () => {
      const trler = await repo.findMany({ locale: "tr" });
      expect(trler.map((r) => r.title).sort()).toEqual(["A-tr", "B-tr"]);
    });

    test("findMany boş filtreyle hepsini verir", async () => {
      expect(await repo.findMany()).toHaveLength(3);
    });

    test("eksik anahtar alanı net hata verir", async () => {
      expect(repo.findByKey({ postId: POST_A } as never)).rejects.toThrow(/anahtar alanı 'locale'/);
    });

    test("tabloda olmayan kolon net hata verir", async () => {
      expect(repo.findMany({ yokKolon: 1 } as never)).rejects.toThrow(/kolon değil/);
    });

    test("undefined değer reddedilir (IS NULL için açıkça null geç)", async () => {
      expect(repo.findMany({ body: undefined } as never)).rejects.toThrow(/undefined/);
    });
  });

  describe("silme", () => {
    beforeEach(async () => {
      await repo.upsertMany([
        { postId: POST_A, locale: "tr", title: "A-tr" },
        { postId: POST_A, locale: "en", title: "A-en" },
      ]);
    });

    test("deleteByKey yalnızca o dili siler", async () => {
      expect(await repo.deleteByKey({ postId: POST_A, locale: "tr" })).toBe(true);

      expect(await repo.count()).toBe(1);
      expect((await repo.findMany())[0]!.locale).toBe("en");
    });

    test("deleteWhere kısmi filtreyle siler", async () => {
      expect(await repo.deleteWhere({ postId: POST_A })).toBe(2);
      expect(await repo.count()).toBe(0);
    });

    test("BOŞ filtreyle toplu silme ENGELLENİR", async () => {
      expect(repo.deleteWhere({})).rejects.toThrow(/boş filtreyle toplu yazma/);
      expect(await repo.count()).toBe(2);
    });

    test("softDelete: satır kalır ama okumalarda görünmez", async () => {
      await softRepo.deleteByKey({ postId: POST_A, locale: "tr" });

      expect(await softRepo.findByKey({ postId: POST_A, locale: "tr" })).toBeUndefined();
      expect(
        (await softRepo.findByKey({ postId: POST_A, locale: "tr" }, { withDeleted: true }))?.title
      ).toBe("A-tr");
      // Fiziksel olarak duruyor: soft-delete'siz repo görür.
      expect(await repo.count()).toBe(2);
    });
  });

  describe("transaction", () => {
    test("hata ROLLBACK eder", async () => {
      await expect(
        repo.transaction(async (tx) => {
          await tx.upsert({ postId: POST_A, locale: "tr", title: "A" });
          throw new Error("iptal");
        })
      ).rejects.toThrow("iptal");

      expect(await repo.count()).toBe(0);
    });

    test("başarılı transaction kalıcıdır", async () => {
      await repo.transaction(async (tx) => {
        await tx.upsert({ postId: POST_A, locale: "tr", title: "A" });
        await tx.upsert({ postId: POST_A, locale: "en", title: "B" });
      });

      expect(await repo.count()).toBe(2);
    });
  });

  describe("yapılandırma", () => {
    test("boş keyColumns reddedilir", () => {
      expect(() => new CompositeKeyRepository(db, translations, { keyColumns: [] })).toThrow(
        /keyColumns boş olamaz/
      );
    });

    test("var olmayan anahtar kolonu AÇILIŞTA yakalanır", () => {
      expect(
        () => new CompositeKeyRepository(db, translations, { keyColumns: ["yok" as never] })
      ).toThrow(/kolon değil/);
    });

    test("softDelete=true ama deletedAt kolonu yoksa açılışta hata", () => {
      const noSoft = pgTable("no_soft", { a: text("a").notNull(), b: text("b").notNull() });
      expect(
        () => new CompositeKeyRepository(db, noSoft, { keyColumns: ["a"], softDelete: true })
      ).toThrow(/deletedAt/);
    });
  });
});
