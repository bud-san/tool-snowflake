/**
 * 生成履歴（ブラウザの localStorage にだけ保存し、外部には送らない）。
 *
 * 結晶は同じ文字列から必ず同じ形になるため、保存するのは入力テキストと日時だけ。
 * 表示するときにテキストから結晶を描き直す。
 */

export interface HistoryEntry {
  text: string;
  /** 生成した日時（ms） */
  at: number;
}

const STORAGE_KEY = "hash-snowflake:history";
/** 保存する最大件数 */
export const HISTORY_LIMIT = 10;
/** これより古い履歴は自動で消す（ms） */
export const HISTORY_TTL = 24 * 60 * 60 * 1000;

const isEntry = (value: unknown): value is HistoryEntry =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as HistoryEntry).text === "string" &&
  typeof (value as HistoryEntry).at === "number";

function write(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // プライベートモードなどで保存できない場合は、履歴なしとして動かす
  }
}

/** 新しい順の履歴。期限切れのものはここで取り除く */
export function loadHistory(now = Date.now()): HistoryEntry[] {
  let entries: HistoryEntry[] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (Array.isArray(parsed)) entries = parsed.filter(isEntry);
  } catch {
    return [];
  }
  const fresh = entries.filter((e) => now - e.at < HISTORY_TTL).slice(0, HISTORY_LIMIT);
  if (fresh.length !== entries.length) write(fresh);
  return fresh;
}

/** 先頭に追加する。同じテキストがあれば重複させずに先頭へ移す */
export function addToHistory(text: string, now = Date.now()): HistoryEntry[] {
  const entries = [{ text, at: now }, ...loadHistory(now).filter((e) => e.text !== text)].slice(0, HISTORY_LIMIT);
  write(entries);
  return entries;
}
