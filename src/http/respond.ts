import type { Context } from "hono";
import type { Translate } from "../i18n/translator";

/**
 * Başarılı cevap zarfı yardımcıları — FABRİKA. core/ tüm API zarfının tek sahibi:
 * hata tarafında `error-handler` `{ success:false, message, ... }` üretiyor;
 * burası simetriği `{ success:true, message, data? }`'yi üretir. Böylece rotalar
 * elle `c.json({ success:true, ... })` yazmaz ve zarf hiçbir yerde kaymaz.
 *
 * Mesaj bir çeviri ANAHTARIDIR (örn. "university.created"); `translate` verilirse
 * isteğin diline çevrilir (hata tarafıyla aynı mekanizma). `translate` verilmezse
 * anahtar aynen mesaj olur → i18n istemeyen proje de bu fabrikayı kullanabilir.
 * Zarf şekli (success/message/data) core'da SABİT; diller/metinler projede.
 *
 * İsimlendirme: mesaj-only mutasyonlar (silme vb.) için `done`. Kasıtlı olarak
 * HTTP 204 DEĞİL 200 + mesaj döner — zarf başarı mesajını taşımalı, 204'ün
 * gövdesi olamaz.
 */
export interface ResponderOptions {
  translate?: Translate;
  /** İsteğin dilini context'ten okuma yolu. Varsayılan `c.get("locale")`. */
  getLocale?: (c: Context) => string;
}

/**
 * `Key`: geçerli mesaj anahtarları union'ı. Proje `createResponder<MessageKey>(...)`
 * ile kurar; böylece `ok`/`created`/`done`'a yazım hatalı anahtar geçmek DERLEME
 * hatası olur (aynı `*.permissions.ts` typo-güvenliği felsefesi). Varsayılan
 * `string` — i18n/anahtar kullanmayan proje serbest metin geçebilir.
 */
export function createResponder<Key extends string = string>(options: ResponderOptions = {}) {
  const { translate, getLocale = (c) => (c.get("locale") as string | undefined) ?? "" } = options;

  const message = (c: Context, key: Key, params?: Record<string, unknown>) =>
    translate ? translate(key, getLocale(c), params) : key;

  return {
    ok<T>(c: Context, data: T, key: Key, params?: Record<string, unknown>) {
      return c.json({ success: true, message: message(c, key, params), data }, 200);
    },
    created<T>(c: Context, data: T, key: Key, params?: Record<string, unknown>) {
      return c.json({ success: true, message: message(c, key, params), data }, 201);
    },
    done(c: Context, key: Key, params?: Record<string, unknown>) {
      return c.json({ success: true, message: message(c, key, params) }, 200);
    },
  };
}
