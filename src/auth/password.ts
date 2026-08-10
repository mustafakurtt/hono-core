/**
 * Taşınabilir şifre hash yardımcıları. Bun.password varsayılan olarak bcrypt
 * kullanır (cost 10). Config gerektirmez; core'da doğrudan durur.
 */

/** Düz metin şifreyi güvenli bir hash'e çevirir. */
export const hashPassword = async (password: string): Promise<string> =>
  await Bun.password.hash(password);

/** Girilen şifre ile saklanan hash'i karşılaştırır. */
export const verifyPassword = async (password: string, hash: string): Promise<boolean> =>
  await Bun.password.verify(password, hash);

/**
 * Karakter sınıfları. Karıştırılabilir karakterler (I/O/l/0/1) bilinçli olarak
 * DIŞARIDA: geçici şifre çoğu zaman elle okunup yazılır.
 *
 * Sınıflar AYRI sabitler olarak durur; tek bir alfabe içinde ofsetle
 * indekslemek (`alphabet[26 + n]`) sınıf sınırlarının kaymasına ve "garantili"
 * denen çeşitliliğin sessizce bozulmasına yol açıyordu.
 */
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?";
const ALPHABET = UPPERCASE + LOWERCASE + DIGITS;

/** Her sınıftan birer karakter garanti edildiği için asgari uzunluk bu kadardır. */
const GUARANTEED_CLASSES = [UPPERCASE, LOWERCASE, DIGITS, SYMBOLS] as const;
const MINIMUM_LENGTH = GUARANTEED_CLASSES.length * 2;

/** `byte`'ı bir alfabenin indeksine indirger. */
const pick = (alphabet: string, byte: number): string => alphabet[byte % alphabet.length];

/**
 * Kriptografik olarak güçlü, okunabilir geçici şifre üretir (örn. admin şifre
 * sıfırlaması). İlk dört karakter her sınıftan birini GARANTİ eder — çoğu şifre
 * politikası bunu şart koşar — kalanı rastgeledir. Amaç tek kullanımlık geçici
 * şifredir; kullanıcı ilk girişte değiştirir.
 */
export const generatePassword = (length = 16): string => {
  const size = Math.max(length, MINIMUM_LENGTH);
  const bytes = crypto.getRandomValues(new Uint8Array(size));

  const prefix = GUARANTEED_CLASSES.map((alphabet, index) => pick(alphabet, bytes[index])).join("");
  const body = Array.from(bytes.subarray(prefix.length), (byte) => pick(ALPHABET, byte)).join("");

  return prefix + body;
};
