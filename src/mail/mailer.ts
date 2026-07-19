import nodemailer, { type Transporter } from "nodemailer";

export type { Transporter };

/**
 * Taşınabilir SMTP mailer fabrikası. core/ proje-bağımsız kalsın diye tüm SMTP
 * ayarları dışarıdan verilir (env core'a girmez). Tek transport örneği döner —
 * uygulama boyunca yeniden kullanılır (her mailde yeni bağlantı açmak pahalıdır).
 */
export interface CreateMailerOptions {
  host: string;
  port: number;
  /** 465 → true; 587/1025 → false (STARTTLS ya da düz). */
  secure: boolean;
  /** Kimlik yoksa (örn. Mailpit) hiç gönderilmez — boş AUTH denemesini önler. */
  auth?: { user: string; pass: string };
  ignoreTLS?: boolean;
  /**
   * SMTP bağlantı havuzu. `true` iken nodemailer bağlantıları açık tutup yeniden
   * kullanır — art arda çok mail atan bir kuyruk worker'ı (ör. doğrulama mailleri)
   * her gönderimde yeniden el sıkışmaz. Verilmezse (varsayılan) gönderim başına
   * bağlantı; düşük hacimde/Mailpit'te fark etmez. `maxConnections` havuz boyutunu
   * ayarlar (nodemailer varsayılanı 5).
   */
  pool?: boolean;
  maxConnections?: number;
}

export function createMailer(options: CreateMailerOptions): Transporter {
  const { host, port, secure, auth, ignoreTLS, pool, maxConnections } = options;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    ...(auth ? { auth } : {}),
    ...(ignoreTLS ? { ignoreTLS: true } : {}),
    ...(pool ? { pool: true } : {}),
    ...(maxConnections ? { maxConnections } : {}),
  });
}

export interface SendMailParams {
  from: string;
  to: string;
  subject: string;
  html: string;
  /** Düz metin alternatifi: spam skorunu düşürür, metin okuyucular için şart. */
  text: string;
}

/** Maili gönderir. Hata FIRLATIR — çağıran (ör. kuyruk worker'ı) retry uygulayabilsin. */
export async function sendMail(transporter: Transporter, params: SendMailParams) {
  return transporter.sendMail(params);
}

/** SMTP'ye ulaşılabiliyor mu? Açılışta bilgi amaçlı; başarısızsa uygulama çökmez. */
export async function verifyMailConnection(transporter: Transporter): Promise<boolean> {
  try {
    await transporter.verify();
    return true;
  } catch {
    return false;
  }
}
