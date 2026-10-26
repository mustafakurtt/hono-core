/**
 * Bir kaydın önce/sonra hâlini alan alan karşılaştırır: denetim kaydına "kim
 * neyi neye çevirdi" yazılabilsin. Saf fonksiyon; nereye yazılacağını bilmez,
 * Hono ya da veritabanı tanımaz. Denetim sink'i (`GuardAuditSink`) içinde
 * kullanılmak üzere tasarlandı.
 */

/** Bir alanın önceki ve sonraki değeri. `path` iç içe yoldur (`data.seo.title`). */
export interface AuditChange {
  path: string;
  before: string | null;
  after: string | null;
}

/** Değişikliğin alan alan farkı. `more`: sınır yüzünden yazılmayan alan sayısı. */
export interface AuditChanges {
  items: AuditChange[];
  more: number;
}

export interface DiffLimits {
  /** En çok kaç alan yazılsın (denetim satırı şişmesin). Varsayılan 60. */
  maxItems?: number;
  /** Değer başına en çok kaç karakter. Varsayılan 300. */
  maxValue?: number;
}

const show = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/** İç içe nesneyi yol → değer eşlemesine açar: `{ seo: { title } }` → `seo.title`, diziler `body.0`. */
function flatten(value: unknown, path: string, out: Map<string, string>) {
  if (value === undefined) return;
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item] as const)
      : Object.entries(value);
    if (entries.length === 0 && path) out.set(path, Array.isArray(value) ? "[]" : "{}");
    for (const [key, item] of entries) flatten(item, path ? `${path}.${key}` : key, out);
    return;
  }
  out.set(path, show(value));
}

/**
 * Önce ve sonra arasındaki farkı çıkarır. Değişmeyen alanlar yazılmaz. Yeni
 * kayıtta `before` boş nesnedir, silinende `after`. Fark yoksa `null`.
 */
export function diffChanges(before: unknown, after: unknown, limits: DiffLimits = {}): AuditChanges | null {
  const { maxItems = 60, maxValue = 300 } = limits;
  const clip = (text: string) => (text.length > maxValue ? `${text.slice(0, maxValue)}…` : text);

  const previous = new Map<string, string>();
  const next = new Map<string, string>();
  flatten(before, "", previous);
  flatten(after, "", next);

  const paths = [...new Set([...previous.keys(), ...next.keys()])].filter(
    (path) => previous.get(path) !== next.get(path)
  );
  if (paths.length === 0) return null;

  const valueAt = (source: Map<string, string>, path: string) => {
    const value = source.get(path);
    return value === undefined ? null : clip(value);
  };
  const items = paths.slice(0, maxItems).map((path) => ({
    path,
    before: valueAt(previous, path),
    after: valueAt(next, path),
  }));
  return { items, more: Math.max(0, paths.length - maxItems) };
}
