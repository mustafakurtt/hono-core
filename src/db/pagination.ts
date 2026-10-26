/**
 * Sayfalı listenin ortak kabuğu: `limit/offset` hesabı, toplam sayının
 * açılması ve zarf. Sorguları çağıran kurar (her birinin join'i ve sıralaması
 * farklıdır); burada ORM ya da tablo bilgisi yoktur, yalnızca iki fonksiyon
 * çağrılır.
 *
 * Satırlar ve toplam BİRLİKTE sorulur: art arda iki gidiş-dönüş değil, paralel.
 */

/** Sayfalı yanıt. Tüketici kendi sözleşmesinde aynı alanlarla tanımlıysa yapısal olarak uyumludur. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaginateQuery<Row, Item> {
  /** Sayfanın satırları; `limit` ve `offset` verilir. */
  rows: (limit: number, offset: number) => PromiseLike<Row[]>;
  /** Aynı süzgeçle toplam sayı. Süzgeci atlamak sayfa sayısını yanlış gösterir. */
  total: () => PromiseLike<{ total: number }[]>;
  map: (row: Row) => Item;
}

/** `page` 1'den başlar. */
export async function paginate<Row, Item>(
  page: number,
  pageSize: number,
  query: PaginateQuery<Row, Item>
): Promise<Page<Item>> {
  const [rows, [totals]] = await Promise.all([query.rows(pageSize, (page - 1) * pageSize), query.total()]);
  return { items: rows.map(query.map), total: totals?.total ?? 0, page, pageSize };
}
