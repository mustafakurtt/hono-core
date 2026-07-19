import type { Logger } from "../logger/logger";

/**
 * Taşınabilir graceful shutdown yöneticisi. core/ proje-bağımsız kalsın diye
 * KAPATILACAK kaynakları bilmez — proje `register(name, fn)` ile enjekte eder
 * (setGuardAuditSink / createLogger ile aynı dikiş deseni).
 *
 * SIGTERM/SIGINT geldiğinde kayıtlı görevleri KAYIT SIRASIYLA (FIFO) çalıştırır:
 * önce trafiği kes (HTTP server), sonra bağımlılıkları kapat (kuyruk, redis, db,
 * mail) — böylece kapanış sırasında yeni istek gelmez ve yarım job/bağlantı kalmaz.
 * Bir görev fırlatsa bile diğerleri denenir (best-effort). `timeoutMs` bütçesi
 * aşılırsa zorla çıkılır (askıda kalan bir kaynak deploy'u kilitlemesin).
 *
 * `onExit` enjekte edilebilir → süreç sonlandırmadan birim test edilebilir.
 */
export interface ShutdownManagerOptions {
  logger?: Logger;
  /** Toplam kapanış bütçesi (ms). Aşılırsa zorla çıkılır. Varsayılan 10000. */
  timeoutMs?: number;
  /** Dinlenecek sinyaller. Varsayılan SIGTERM + SIGINT. */
  signals?: NodeJS.Signals[];
  /** Kapanış bitince/timeout'ta çağrılır. Varsayılan `process.exit`. */
  onExit?: (code: number) => void;
}

export interface ShutdownManager {
  /** Bir kapatma görevi ekler. Sıra önemlidir (FIFO): önce eklenen önce çalışır. */
  register(name: string, run: () => Promise<void> | void): void;
  /** Sinyal dinleyicilerini kurar (bir kez çağrılmalı). */
  install(): void;
  /** Kapanışı elle tetikler (test/özel durumlar). İkinci çağrı yok sayılır. */
  shutdown(reason: string): Promise<void>;
}

export function createShutdownManager(options: ShutdownManagerOptions = {}): ShutdownManager {
  const {
    logger,
    timeoutMs = 10_000,
    signals = ["SIGTERM", "SIGINT"],
    onExit = (code) => process.exit(code),
  } = options;

  const tasks: { name: string; run: () => Promise<void> | void }[] = [];
  let started = false;

  const shutdown = async (reason: string): Promise<void> => {
    if (started) return; // aynı anda ikinci sinyal / tekrar çağrı → yok say
    started = true;
    logger?.info({ reason, tasks: tasks.length }, "graceful shutdown started");

    // Askıda kalan bir kaynak süreci sonsuza dek tutmasın.
    const budget = setTimeout(() => {
      logger?.error({ timeoutMs }, "graceful shutdown timed out; forcing exit");
      onExit(1);
    }, timeoutMs);
    (budget as { unref?: () => void }).unref?.();

    for (const task of tasks) {
      try {
        await task.run();
        logger?.debug({ task: task.name }, "shutdown task done");
      } catch (err) {
        // Best-effort: bir kaynağın kapanamaması diğerlerini engellemesin.
        logger?.error({ err, task: task.name }, "shutdown task failed");
      }
    }

    clearTimeout(budget);
    logger?.info("graceful shutdown complete");
    onExit(0);
  };

  return {
    register(name, run) {
      tasks.push({ name, run });
    },
    install() {
      for (const signal of signals) {
        process.on(signal, () => void shutdown(signal));
      }
    },
    shutdown,
  };
}
