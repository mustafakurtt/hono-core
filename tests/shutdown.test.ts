import { describe, expect, test } from "bun:test";
import { createShutdownManager } from "../src/http";

/** `onExit` enjekte edildiği için süreç sonlandırmadan test edilebilir. */
const newManager = (options: Parameters<typeof createShutdownManager>[0] = {}) => {
  const exitCodes: number[] = [];
  const manager = createShutdownManager({ onExit: (code) => exitCodes.push(code), ...options });
  return { manager, exitCodes };
};

describe("createShutdownManager", () => {
  test("görevleri KAYIT SIRASIYLA çalıştırır", async () => {
    const order: string[] = [];
    const { manager } = newManager();

    manager.register("http", () => void order.push("http"));
    manager.register("redis", () => void order.push("redis"));
    manager.register("db", () => void order.push("db"));

    await manager.shutdown("test");

    // Sıra sözleşmenin parçası: önce trafiği kes, sonra bağımlılıkları kapat.
    expect(order).toEqual(["http", "redis", "db"]);
  });

  test("bir görev fırlatsa diğerleri yine çalışır (best-effort)", async () => {
    const done: string[] = [];
    const { manager, exitCodes } = newManager();

    manager.register("ilk", () => void done.push("ilk"));
    manager.register("patlayan", () => {
      throw new Error("kapatılamadı");
    });
    manager.register("son", () => void done.push("son"));

    await manager.shutdown("test");

    expect(done).toEqual(["ilk", "son"]);
    // Bir görevin başarısızlığı kapanışı başarısız SAYMAZ.
    expect(exitCodes).toEqual([0]);
  });

  test("async görevleri bekler", async () => {
    const done: string[] = [];
    const { manager } = newManager();

    manager.register("yavaş", async () => {
      await Bun.sleep(10);
      done.push("yavaş");
    });
    manager.register("hızlı", () => void done.push("hızlı"));

    await manager.shutdown("test");

    expect(done).toEqual(["yavaş", "hızlı"]);
  });

  test("ikinci çağrı yok sayılır (aynı anda iki sinyal)", async () => {
    let runs = 0;
    const { manager, exitCodes } = newManager();
    manager.register("tek", () => void runs++);

    await manager.shutdown("SIGTERM");
    await manager.shutdown("SIGINT");

    expect(runs).toBe(1);
    expect(exitCodes).toEqual([0]);
  });

  test("bütçe aşılırsa hata koduyla zorla çıkar", async () => {
    const { manager, exitCodes } = newManager({ timeoutMs: 10 });
    manager.register("askıda", () => Bun.sleep(200));

    await manager.shutdown("test");

    // Askıda kalan bir kaynak deploy'u kilitlemesin: önce zorla çıkış (1).
    expect(exitCodes[0]).toBe(1);
  });

  test("görev yokken de düzgün tamamlanır", async () => {
    const { manager, exitCodes } = newManager();
    await manager.shutdown("test");
    expect(exitCodes).toEqual([0]);
  });
});
