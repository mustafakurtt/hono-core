import pino, { type Logger, type LoggerOptions, type TransportTargetOptions } from "pino";

export type { Logger, TransportTargetOptions };

/**
 * Log seviyeleri, çıplak string yerine tipli sabit olarak. Değerler pino'nun
 * seviye adlarıyla (ve `Logger` üzerindeki `LogFn` metod adlarıyla) birebir
 * örtüşür — böylece `logger[level](...)` tip-güvenli çağrılabilir ve seviyeler
 * uygulama genelinde magic string olarak gezmez.
 */
export const LogLevel = {
  Trace: "trace",
  Debug: "debug",
  Info: "info",
  Warn: "warn",
  Error: "error",
  Fatal: "fatal",
  /** Tüm çıktıyı kapatır (pino'nun özel seviyesi) — test/CI'da gürültüyü keser. */
  Silent: "silent",
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/**
 * Gerçekten bir log satırı YAZILABİLEN seviyeler. `Silent` bir EŞİKTİR (createLogger'a
 * "hiçbir şey yazma" demek için), emisyon seviyesi değil — pino'da `logger.silent()`
 * diye bir metod yoktur, `logger[level](...)` oraya düşerse çalışma anında patlar.
 * Bir seviyeyi yazmak için kullanan her yer (bkz. createRequestLogger) bu tipi almalı.
 */
export type EmittableLogLevel = Exclude<LogLevel, typeof LogLevel.Silent>;

/**
 * core/ proje-bağımsız kalmalı: bu fabrika `env`/`shared` bilmez, seviye ve
 * hedef tercihini çağıran belirler. Proje kendi kök logger'ını
 * `shared/logger/logger.ts`'de bu fabrikayı çağırarak kurar — aynı enjeksiyon
 * deseni `setGuardAuditSink` ile kullanılıyor (core mekanizmayı tanımlar,
 * proje kendi örneğini kurar).
 */
export interface CreateLoggerOptions {
  level?: string;
  /** Geliştirmede insan-okunur renkli çıktı; üründe ham JSON (log toplayıcılar için). */
  pretty?: boolean;
  /** Her satıra eklenecek sabit alanlar (örn. { app: "universityClub" }). */
  bindings?: Record<string, unknown>;
  /**
   * BİR veya BİRDEN FAZLA log hedefi (pino transport targets). Verilirse `pretty`
   * yok sayılır ve loglar bu hedeflerin HEPSİNE yazılır — örn. aynı anda konsol +
   * dosya + uzak toplayıcı; her hedef kendi `level`'ını alabilir. İhtiyaca göre
   * proje tek hedef de birden fazla hedef de geçebilir.
   */
  transports?: TransportTargetOptions[];
  /**
   * Hassas alanların log çıktısında maskelenmesi (pino `redact`). Yol listesi
   * (`["req.headers.authorization", "*.password"]`) ya da tam config nesnesi.
   * Verilmezse maskeleme yapılmaz — geriye tam uyumlu, hiçbir şeyi zorunlu kılmaz.
   */
  redact?: LoggerOptions["redact"];
  /**
   * Alanlara özel serializer'lar (pino `serializers`). Verilenler, varsayılan
   * `err` serializer'ının ÜZERİNE MERGE edilir (aynı anahtar çağıranınkiyle
   * ezilebilir); `err` verilmezse stack'li varsayılan korunur.
   */
  serializers?: LoggerOptions["serializers"];
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { level = LogLevel.Info, pretty = false, bindings, transports, redact, serializers } =
    options;

  const pinoOptions: LoggerOptions = {
    level,
    // Error nesneleri (stack dahil) doğru serileşsin — düz console.error(err)
    // yerine geçen tüm çağrılar bunu otomatik kullanır. Çağıran ek serializer
    // verebilir; aynı anahtarla `err`'i de ezebilir.
    serializers: { err: pino.stdSerializers.err, ...serializers },
    ...(bindings ? { base: bindings } : {}),
    ...(redact ? { redact } : {}),
    ...buildTransport({ pretty, transports }),
  };

  return pino(pinoOptions);
}

/**
 * Hedef seçimi: açık `transports` > `pretty` kısayolu > ham JSON. Birden fazla
 * hedef varsa pino hepsine paralel yazar (`transport.targets`).
 */
function buildTransport({
  pretty,
  transports,
}: Pick<CreateLoggerOptions, "pretty" | "transports">): Pick<LoggerOptions, "transport"> {
  if (transports && transports.length > 0) {
    return { transport: { targets: transports } };
  }
  if (pretty) {
    return {
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
    };
  }
  return {};
}
