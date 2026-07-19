/**
 * core/mail barrel — nodemailer üzerine ince, env-bilmez taşıma katmanı.
 * Proje `createMailer` ile transport'u kurar ve `from` gibi sabitleri kendi sarar.
 */
export {
  createMailer,
  sendMail,
  verifyMailConnection,
  type CreateMailerOptions,
  type SendMailParams,
} from "./mailer";
