/**
 * 入力欄に文字列を 1 文字ずつ打ち込む演出（初期表示のサンプルや、履歴から戻すときに使う）。
 *
 * 文字は書記素（見た目の 1 文字）単位で区切るので、絵文字や結合文字が途中で崩れない。
 * 長い文字列でも待たされないよう、全体の時間には上限を設ける。
 * prefers-reduced-motion: reduce のときは打ち込まずに一度で入れる。
 */

export const TYPEWRITER = {
  /** 打ち始めるまでの間（ms） */
  startDelay: 250,
  /** 1 文字あたりの間隔（ms） */
  interval: 75,
  /** 間隔のゆらぎ（interval に対する比）。0.4 なら 0.6〜1.4 倍 */
  jitter: 0.4,
  /** 打ち込み全体の上限（ms）。長い文字列はこれに収まるよう間隔を詰める */
  maxDuration: 1400,
  /** 打ち終えてから次の処理（生成）に移るまでの間（ms） */
  endDelay: 180,
} as const;

const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

/** 中断されたら false を返す */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** promise が解決するまで待つ。中断されたら false を返す */
function until(promise: Promise<unknown>, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const onAbort = () => resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve(!signal.aborted);
      },
      () => resolve(!signal.aborted),
    );
  });
}

export interface TypeOptions {
  /** 入力欄を空にしたあと、これが解決するまで打ち始めない（読み込み時の演出を待つ） */
  ready?: Promise<unknown>;
  /** ready のあと打ち始めるまでの間（ms）。省略時は TYPEWRITER.startDelay */
  startDelay?: number;
}

/**
 * input の中身を text に打ち替える。
 * 最後まで打ち終えたら true、途中で signal が中断されたら false（入力欄はその時点の状態のまま）。
 */
export async function typeInto(
  input: HTMLInputElement,
  text: string,
  signal: AbortSignal,
  { ready, startDelay = TYPEWRITER.startDelay }: TypeOptions = {},
): Promise<boolean> {
  const chars = Array.from(segmenter.segment(text), (s) => s.segment);
  if (chars.length === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (signal.aborted) return false;
    input.value = text;
    return true;
  }

  const { interval, jitter, maxDuration, endDelay } = TYPEWRITER;
  const step = Math.min(interval, maxDuration / chars.length);
  input.value = "";
  input.dataset.typing = "";
  try {
    if (ready && !(await until(ready, signal))) return false;
    if (!(await sleep(startDelay, signal))) return false;
    for (const char of chars) {
      if (!(await sleep(step * (1 + (Math.random() * 2 - 1) * jitter), signal))) return false;
      input.value += char;
      // 入力欄より長い文字列でも、打っている位置が見えるようにする
      input.scrollLeft = input.scrollWidth;
    }
    return await sleep(endDelay, signal);
  } finally {
    delete input.dataset.typing;
  }
}
