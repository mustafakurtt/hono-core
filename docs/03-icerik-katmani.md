# İçerik katmanı (CMS yolu) — plan, henüz başlanmadı

> **Durum (2026-10-26):** Tasarım tartışıldı ve itirazlarla netleşti,
> **uygulamaya başlanmadı**. Bu belge kararların ve açık soruların kaydıdır.
> Başlamadan önce "Kararlar" bölümündeki üç seçim yapılmalı.

## Hedef

Üç proje (rfcear, laputa-next, fenixAVM-bun) aynı ürün biçiminde: Hono API +
yönetim paneli + Next.js web. Her biri içerik yönetimini elle yeniden yazıyor.

Hedef: yeni bir içerik tipini uçtan uca **dakikalar** içinde eklemek, saatler
içinde değil. Bugün rfcear'da bir içerik tipi ~12 dosyaya dokunuyor (API
koleksiyon kaydı, contracts şeması + tipi, etiketler, web deposu, http
adaptörü, seed adaptörü + verisi, panel kaydı + formu + alanları, web
sorguları). Hedef 3–4 dokunuş.

"Dinamik ama proje özelinde": core mekanizmayı verir (saklama, doğrulama,
yayın, site yenileme, medya), proje tiplerini **kendi zod şemalarıyla, kodda**
tanımlar.

## Aşamalar

| Aşama | Ne | Durum |
|---|---|---|
| 1 | Ortak altyapı (IP, 2FA, hız sınırı, push…) | ✅ v0.5–v0.7 |
| 2a | **Temel (v0.8):** site yenileme kuyruğu (outbox) + PG hata çözücü + depolama anahtarı | Planlandı |
| 2b | **İçerik deposu (v0.9):** `defineContentTypes` + jsonb koleksiyon/tekil depoları + yazma oturumu | Planlandı |
| 2c | **Medya hattı:** yükleme, kullanım koruması, dosya sunumu (Range/ETag) | Önerildi |
| 3 | **Şemadan üretim:** tek zod tanımı API + doğrulama + panel formunu besler | Kapı açık bırakılacak |

## Bulgular (envanter özeti)

Tam envanter tasarım ajanının raporundadır; özü:

- **Saklama farklı:** fenix ilişkisel (sütun başına tablo + `*_translations`
  tabloları, durum akışı, `version` kilidi). rfcear ve laputa **tek jenerik
  tablo**: `content_items(collection, slug, order, published, data jsonb)` +
  `content_singletons(key, data jsonb)`. Yani "tek içerik deposu" üçüne birden
  uymaz.
- **Gerçekten üçünde ortak:** site yenileme kuyruğu (panelde içerik değişince
  web'in önbelleğini tazeleyen mekanizma), PG benzersizlik hatası çözme,
  depolama anahtarı biçimi (`YYYY/MM/<uuid>.<ext>`).
- **İkisinde ortak (rfcear + laputa):** jsonb içerik deposu, alan tanımından
  panel form motoru, web `ContentRepository` (seed/http).
- **Yalnız fenix:** medya varyantları, EXIF temizleme, kopya tespiti, çöp
  kutusu, durum akışı/zamanlama, yönlendirmeler, slug geçmişi.
- **Core'un `/cache`'ini içerik için kimse kullanmıyor.** Asıl "önbellek"
  ihtiyacı Next'in etiket önbelleğini düşüren bildirim kuyruğudur.
- **Çatal uyarısı:** rfcear laputa'nın çatalı. "İki projede ortak" şartı bu
  ikisiyle sağlanırsa tek bir tasarım iki kez sayılmış olabilir. İçerik
  deposu, üçüncü bir projeye (fenix dışı yeni ürün) bakılmadan dondurulmamalı.

## İlkeler (bu katmana özel)

- Tip tanımları **veritabanında değil, kodda** (Umbraco'nun "document type"
  tabloları gibi değil). Kod + zod tek kaynak.
- fenix'in ilişkisel modülleri jsonb'ye zorlanmaz; fenix yalnızca altyapı
  parçalarını (2a) alabilir.
- `{tr, en}` iki dilli alan modeli core'a dayatılmaz (yalnız rfcear kullanıyor).
- Durum akışı / yayın modeli genellenmez; jenerik sorgu dili ya da eklenti
  sistemi kurulmaz.
- Panel core'a girmez: 3. aşamada ayrı bir React paketi olur. Core backend kalır.
- Tel biçimi (`{ success, message, data }` zarfı, `AdminContentItem`) sabit
  kalır; panel ve web ona bağlı.

## 2a taslağı (ilk teslimat, v0.8)

Yerleşim: yeni `/content` (peer yok) ve `/content/pg` (peer: drizzle-orm);
`/db`'ye PG hata yardımcıları, `/storage`'a anahtar ve video tespiti.

```ts
// /content
interface SiteRevalidator<T> { revalidate(tags: readonly T[]): Promise<boolean> } // asla fırlatmaz
createHttpRevalidator({ url, headers, timeoutMs?, body?, logger? })
fanOutRevalidators([...]) · noopRevalidator()
interface AfterCommitNotifier<T, Tx> { stage(tx, tags); dispatch(tags) }

// /content/pg
createRevalidationOutbox({ db, table, revalidator, firstRetryDelaySeconds?, backoff?,
  claimLeaseSeconds?, claimBatch?, giveUpAfterMs?, failureNote?, logger? })
  → { stage, dispatch, notify, enqueue, drain, status }
startRevalidationWorker({ outbox, intervalMs?, collectDue?, startupLookbackMs?, logger? }) → stop()

// /db
pgErrorOf(err) · uniqueViolationOf(err) · PG_ERROR_CODES
// /storage
createStorageKey(ext) · sniffVideoMime(bytes)
```

Doğruluk kuralları fenix'ten (en sağlam sürüm): `stagedAt` koruması (gönderim
sırasında gelen yeni değişikliğin satırı silinmez), `clock_timestamp()`,
`for update skip locked`. Tablo SQL adları serbest (mevcut tablolar korunur).

Geçiş: rfcear/laputa için tek migration (`ADD COLUMN staged_at`), veri
taşınmaz. fenix için şema değişikliği yok.

## Tartışmanın sonuçları

Tasarım ajanının ilk önerisine üç itiraz yöneltildi; sonuçlar:

1. **fenix'e dokunulmuyor → iddia küçüldü, 2a korunuyor.** v0.8'in tüketicileri
   rfcear ve laputa. Sürüm notunda fenix "etkilenmez, benimseme isteğe bağlı"
   olur; "üç projede ortak" iddiası geri çekildi. Çatal zayıflığı burada geçerli
   değil: kuyruğun **tasarımı** bağımsız proje fenix'ten geliyor, rfcear/laputa
   kopyası ise kusurlu (env ve global db modül yüklenirken okunuyor, kuyruğa
   yalnızca hata olunca yazılıyor, etiketler tek tek gidiyor).
   **Tasarım şartı:** fenix sonradan, kodunda değişiklik olmadan uyabilmeli.
   Core'un `SiteRevalidator` / `AfterCommitNotifier` arayüzleri fenix'inkilerle
   birebir aynı tutulur; core testlerinde fenix arayüzlerinin bir kopyasına
   atanabilirlik derleme anında denetlenir. Benimseme günü fenix'te değişen tek
   yer `container/index.ts:40` olur.
2. **Sıralama → kısmen doğrulandı.** 2b'nin ön koşulu çalışan bir kuyruk değil,
   **port** (`AfterCommitNotifier`) ve `uniqueViolationOf`. Deponun yazma yolu
   bildirimi aynı transaction içinde kuyruğa yazmalı. Plan:
   - **v0.8 = 2b'nin temeli** (birkaç gün): `/content` portları + HTTP
     bildirici, `/content/pg` kuyruk + işçi, `/db` PG hataları, `/storage` ekleri.
   - **v0.9 hemen ardından:** `defineContentTypes`, `createContentStore`,
     `createSingletonStore`, en küçük yazma oturumu (tx + stage/dispatch).
     rfcear'da tip başına dokunuş ~12 → ~6; 3. aşama 3–4'e indirir.
   - **Önce spike:** core'un Postgres'inde ~40 satırlık tek test dosyası
     (`drizzle-orm@1.0.0-rc.4`): (a) `.toSQL()` çıktısında SET'te nitelikli kolon
     yok, alt sorguda `for update skip locked` var; (b) farklı SQL adlı tablo
     (`next_attempt_at`); (c) **iki ayrı bağlantıyla** eşzamanlı alma ayrık küme
     verir. Düşerse yedek yol: `db.execute(sql…)` + `sql.identifier`.
3. **EXIF → şimdi projede, bağımlılıksız segment temizleyiciyle** (aşağıda).

## Ayrı iş: fotoğraflarda konum sızıntısı (canlıda)

rfcear ve laputa yüklenen görselin orijinalini olduğu gibi saklıyor ve
sunuyor: içindeki EXIF/GPS (çekildiği yer) ziyaretçiye gider. fenix temizliyor.
Ayrıca rfcear'da dosya yazılıp kayıt düşerse dosya diskte yetim kalıyor.

**Karar: core'u beklemeden proje düzeyinde, bağımlılıksız bir metadata
temizleyiciyle düzelt.** Sıra: rfcear'da yaz → laputa'ya kopyala → core'a
`/storage` `stripImageMetadata` olarak taşı ("önce projede yaz, sonra core'a").

Neden `sharp` değil: API imajı sharp'ı bilerek dışarıda bırakıyor (laputa bunu
ölçerek yaptı: 867 MB → 190 MB); sharp/libvips çözücü açıkları getirir
(laputa denetiminde librsvg açığı çıktı); yeniden kodlama kayıplıdır.

Temizleyici ne yapar: JPEG APP1 (Exif/XMP), APP13 (IPTC), COM; PNG
`eXIf`/`tEXt`/`iTXt`/`zTXt`/`tIME`; WebP `EXIF`/`XMP ` parçaları (+ VP8X
bayrakları ve RIFF boyutu); GIF yorum/uygulama uzantıları; dosya sonuna
eklenmiş veri. Pikseller bayt bayt aynı kalır, renk profili (ICC) korunur.
**Yön (orientation):** EXIF silinince telefon fotoğrafı yan döner; bu yüzden
yalnızca Orientation etiketini taşıyan en küçük APP1 yeniden yazılır. Bozuk
girdi reddedilir. Diskteki mevcut yüklemeler bir kerelik betikle temizlenir.

**Açık kalan:** iPhone videoları konumu MP4/MOV `udta`/`meta` atomlarında
taşır; bunları silmek ofset düzeltmesi ister, minimal düzeltmenin dışında.

## Kararlar

**Önerilen cevaplar (itiraz yoksa böyle):**
- Alt yollar `/content` (peer yok) + `/content/pg` (drizzle-orm).
- rfcear'da her yazım önce kuyruğa düşer, toplu gönderilir; ilk yeniden deneme
  5 sn (seçenekle).
- "24 saat sonra vazgeç" seçenek olur, varsayılan değil (rfcear/laputa açıkça verir).
- fenix 2b içerik deposunu kullanmaz; altyapı parçalarını istediği zaman alır.
- Web `ContentRepository` hono-core'a girmez; 3. aşamaya kadar projelerde kalır.
- Yazma oturumu v0.9'da, içerik deposuyla birlikte.
- laputa v0.8'e, rfcear'da doğrulandıktan sonra ayrı iş olarak geçer.

**Kullanıcının seçmesi gerekenler:**
- **(a)** Videolardaki konum bilgisi: şimdilik kabul edilip panelde uyarı mı,
  yoksa API imajına ffmpeg eklenip temizlik mi?
- **(b)** 3. aşamanın panel paketi nerede yaşayacak? (Öneri: ayrı repo, etiketle sabitlenir.)
- **(c)** v0.8 v0.9'u beklemeden ayrı yayınlansın mı? (Öneri: evet.)

## Başlarken sıra

1. EXIF temizleyici — rfcear, sonra laputa (canlıdaki gizlilik sorunu; core'dan bağımsız).
2. Spike (yukarıda) — sonucu bu belgeye yazılır.
3. v0.8 → rfcear geçişi → v0.9 → rfcear geçişi.

## Riskler

- Drizzle tipleri: yapısal tabloyla jenerik `insert/update` cast gerektirir;
  cast'ler tek dosyada tutulur, testler gerçek Postgres'te koşar.
- Sürüm geriliği: fenix `#accf5ed` (v0.4 dönemi). fenix 2a'yı alacaksa önce
  sürüm atlaması gerekir.
- Migration: yalnızca `ADD COLUMN`; drizzle-kit'in ürettiği SQL elle okunmalı.
- Panel bağı: tel biçimi değişirse üç parça (API, panel, web) birden kırılır.
