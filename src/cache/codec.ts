/**
 * Serialization stratejisi (SRP: depolamadan ayrı). `Cache` facade tipli değerleri
 * bununla string'e/tekrar geri çevirir. Varsayılan JSON; ileride superjson, msgpack
 * vb. takılabilir — store'lara hiç dokunmadan.
 */
export interface Codec {
  encode<T>(value: T): string;
  decode<T>(raw: string): T;
}

/** Varsayılan codec. Not: JSON, Date'i string'e çevirir (round-trip'te Date olmaz). */
export const jsonCodec: Codec = {
  encode: (value) => JSON.stringify(value),
  decode: (raw) => JSON.parse(raw),
};
