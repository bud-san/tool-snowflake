/**
 * 入力文字列から SHA-256 を生成する（Web Crypto API）。
 * 入力はブラウザ内でのみ処理し、外部には送信しない。
 */
export interface HashResult {
  hex: string;
  bytes: Uint8Array;
}

export async function generateHash(input: string): Promise<HashResult> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return { hex, bytes };
}
