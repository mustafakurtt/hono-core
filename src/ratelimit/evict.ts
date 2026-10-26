/**
 * Bellek içi sayaçların (InMemoryRateLimitStore, createThrottle) ortak tahliye mekanizması.
 * Barrel'dan dışa açılmaz; iç ayrıntıdır.
 *
 * ════════════════════════════════════════════════════════════════════════
 * NEDEN "en eski ilk" değil?
 * ════════════════════════════════════════════════════════════════════════
 * Anahtar uzayı saldırganın üretebildiği değerlerden (e-posta, IP) gelir. Salt ekleme
 * sırasıyla (FIFO) tahliye edersek saldırgan önce kurbanın limitini doldurur, sonra
 * `capacity` kadar yeni anahtar gönderir: kurbanın penceresi en eskilerden biri olduğu
 * için atılır ve kilit sıfırlanır. Bu yüzden tahliye sırası:
 *
 *   1. Süresi dolmuş pencereler (zaten anlamsızdır, kaybı yoktur).
 *   2. Canlı pencereler DÜŞÜK SAYIDAN YÜKSEĞE; eşit sayıda en eski önce.
 *
 * Sayı bazlı sıralama limiti bilmeden çalışır (store'un `hit` sözleşmesi limit taşımaz ve
 * tek store farklı limitli sınırlayıcılarca paylaşılabilir): engellenmiş bir pencere, tanımı
 * gereği yüksek sayılıdır. Kurbanı attırmak için saldırgan artık `capacity - 1` canlı
 * anahtarın HER BİRİNİ kurbanın sayısına çıkarmak zorundadır — yaklaşık
 * `capacity × limit` istek, hepsi tek pencere içinde. Varsayılan 10.000 ile bu, bir
 * anahtar yağmurundan çok daha pahalıdır (kalan risk: bkz. sürüm notu).
 *
 * Gelen (şu an sayılan) anahtar hiçbir zaman atılmaz: atılsaydı, depo yüksek sayılı
 * pencerelerle doluyken her yeni anahtar sayılmadan geçer, yani sınırsız kalırdı.
 *
 * ════════════════════════════════════════════════════════════════════════
 * Karmaşıklık: toplu süpürme, anahtar başına amortize O(log n)
 * ════════════════════════════════════════════════════════════════════════
 * Doğru sırayı her yeni anahtarda bulmak tam tarama ister (O(capacity)) — anahtar
 * yağmurunda CPU yükünü katlar. Bunun yerine sınır aşıldığında TEK bir süpürme yapılır ve
 * boyut `capacity - batch`'e (batch ≈ %10) indirilir; sonraki süpürme en az `batch` yeni
 * anahtar sonra gelir. Süpürme O(n log n) (sayı dizisini sıralar), `batch` eklemeye
 * bölününce anahtar başına ~O(log n) amortize. Bedeli: baskı altında tek seferde sınırdan
 * ~%10 fazla düşük sayılı pencere atılır. Normal yükte (sınıra ulaşılmazken) hiçbir şey
 * değişmez. Öncelik kuyruğu/sayı kovaları O(1) verirdi ama hit yolunu ve farklı pencere
 * süreli anahtarların süre dolum sırasını karmaşıklaştırır; ölçülü bir toplu süpürme
 * yeterli.
 */

export interface CountedEntry {
  count: number;
}

/** Süpürme başına boşaltılan pay: kapasitenin ~%10'u, en az 1. */
const reclaimBatch = (capacity: number) => Math.max(1, Math.floor(capacity / 10));

/**
 * `entries.size > capacity` ise süpürür; değilse hiçbir şey yapmaz (O(1)).
 * Map'in yineleme sırası ekleme sırasıdır; çağıran yeni pencereyi delete+set ile sona
 * eklediği için bu sıra "pencere açılış sırası"dır (eşitlikte en eski önce).
 */
export function evictUnderPressure<E extends CountedEntry>(
  entries: Map<string, E>,
  capacity: number,
  isExpired: (entry: E) => boolean,
  keep: string,
): void {
  if (entries.size <= capacity) return;

  // 1) Süresi dolmuşların HEPSİ — bedava geri kazanım.
  for (const [key, entry] of entries) if (key !== keep && isExpired(entry)) entries.delete(key);

  // 2) Hâlâ hedefin üstündeyse canlılardan en düşük sayılı (eşitlikte en eski) olanlar.
  // Hedef, sınırın batch kadar altı: süpürme bir sonraki batch eklemeye kadar tekrarlanmaz.
  const target = Math.max(1, capacity - reclaimBatch(capacity));
  if (entries.size <= target) return;

  const counts = new Float64Array(entries.size - 1); // `keep` hariç adaylar
  let i = 0;
  for (const [key, entry] of entries) if (key !== keep) counts[i++] = entry.count;
  counts.sort();

  const toEvict = Math.min(entries.size - target, counts.length);
  if (toEvict <= 0) return;
  const threshold = counts[toEvict - 1]!;
  let below = 0;
  while (below < toEvict && counts[below]! < threshold) below++;
  let atThreshold = toEvict - below; // eşik sayısında atılacak (en eskiden başlayarak)

  for (const [key, entry] of entries) {
    if (key === keep) continue;
    if (entry.count < threshold) entries.delete(key);
    else if (entry.count === threshold && atThreshold > 0) {
      entries.delete(key);
      atThreshold--;
    }
  }
}
