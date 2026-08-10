# Yayınlanmamış (v0.4.0 hedefi)

**Tek cümlelik özet:** İki yapısal boşluk kapandı — bileşik anahtarlı tablolar
için repository (`upsert` dahil) ve izin kataloğu ↔ veritabanı senkronu.

**Kırıcı mı:** Hayır — tamamı eklemeli.

---

## Etki

| Tüketici | Etkilenir mi | Gereken iş |
|---|---|---|
| laputa-backend | Hayır (ama **kazanç var**) | Zorunlu iş yok. İki isteğe bağlı sadeleştirme aşağıda. |
| uniclub-backend | Hayır | Vendor kopya taşıyor. |
| bun-hono-starter | Hayır | Yeni modüller, mevcut kod etkilenmez. |

---

## Yapılacaklar

**Zorunlu: hiçbir şey.**

### İsteğe bağlı 1: bileşik anahtarlı repository'leri devret

`BaseRepository` tekil `id` kolonu şart koştuğu için çeviri tabloları, ayarlar
ve RBAC bağ tabloları elle yazılıyordu. Artık gerekmiyor:

```ts
const settings = new CompositeKeyRepository(db, siteSettings, {
  keyColumns: ["key", "locale"],
});

await settings.upsert({ key: "site.title", locale: "tr", value: "Laputa" });
await settings.findByKey({ key: "site.title", locale: "tr" });
await settings.findMany({ locale: "tr" });          // bir dilin tamamı
await settings.deleteWhere({ key: "site.title" });  // tüm dilleri
```

`upsert` bu tabloların baskın desenidir ve `BaseRepository`'de karşılığı yoktu.

### İsteğe bağlı 2: `db:bootstrap`'ı core'un mekanizmasına taşı

Elle yazılmış senkron script'leri, kuralları core'da olan bir mekanizmayla
değiştirilebilir. Core depoya dokunmaz; `PermissionStore` portunu proje
(Drizzle ile) uygular:

```ts
const report = await bootstrapPermissions(
  { permissions: PERMISSION_CATALOG, roles: ROLE_BUNDLES },
  drizzlePermissionStore
);

if (totalChanges(report) > 0) await invalidateAuthzCache();
```

---

## Değişiklikler

### Eklendi

- **`CompositeKeyRepository`** (`/db`) — bileşik birincil anahtarlı tablolar
  için: `upsert` / `upsertMany` / `findByKey` / `existsByKey` / `findMany` /
  `updateByKey` / `deleteByKey` / `deleteWhere` / `count` / `transaction`.
  Soft-delete destekler.
- **`bootstrapPermissions` + `totalChanges`** (`/rbac`) — izin kataloğu ↔ depo
  senkronu, `PermissionStore` portu arkasında.

### İç (tüketiciyi etkilemez)

- Filtre kurma kuralları (`undefined` reddi, bilinmeyen kolon hatası, boş filtre
  koruması) `query-filters.ts`e alındı; iki repository de aynı kuralları
  uyguluyor. `BaseRepository`'nin davranışı değişmedi.
- Testler 168 → 222. Bu sürümün tamamı **gerçek Postgres'e karşı** koşuldu.

---

## Doğrulama

```sh
bun run typecheck
bun test
```

---

## Dikkat

- **`upsert` `onConflictDoUpdate` kullanır, `DoNothing` değil.** Var olan satır
  gerçekten güncellenir — açıklama/metin değişiklikleri sessizce yutulmaz.
- **`updatedAt` upsert'te otomatik tazelenir.** Drizzle'ın `$onUpdate` kancası
  yalnızca `.update()` çağrılarında çalışır; upsert'te elle tazelenmezse satır
  güncellenir ama zaman damgası eski kalırdı.
- **`bootstrapPermissions` izin/rol SATIRLARINI silmez**, yalnızca katalog dışı
  kalanları `orphaned` olarak raporlar. Silmek yabancı anahtarları kırabilir;
  karar operatörün.
- **Ama rol↔izin BAĞLARINI kaldırır.** Bir izin rol paketinden çıkarıldıysa rol
  onu gerçekten kaybeder — güvenlik açısından anlamlı olan tek silme budur.
  Katalogda tanımlı olmayan rollerin bağlarına dokunulmaz.
- **Senkron sonrası authz cache'ini düşür.** Core cache'i bilmez; bayat bir
  cache senkronun etkisini geciktirir. `totalChanges(report) > 0` kontrolü bunun
  için var.
- **Transaction çağıranın işi.** Tüm değişikliklerin atomik olması isteniyorsa
  `bootstrapPermissions` kendi transaction'ın içinde çağrılmalı.
- Sürümü etikete kilitle (`#v0.4.0`), `main`'e bağlanma.
- Henüz **etiketlenmedi**; `package.json` hâlâ `0.3.0`.

---

## Bağlantılar

Bulgular: [`../01-bulgular.md`](../01-bulgular.md) — `T-1`, `T-4`
