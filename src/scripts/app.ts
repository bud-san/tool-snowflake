/** 入力・Generate・履歴の配線 */
import { animateSnowflake, type AnimationHandle } from "../lib/animate";
import type { AnimationOverrides } from "../lib/animation-config";
import { mountDiamondDust, mountTwinkle } from "../lib/diamond-dust";
import { downloadSvg, snowflakeFileName, snowflakeSvgFile } from "../lib/export";
import { addToHistory, loadHistory, type HistoryEntry } from "../lib/history";
import { renderSnowflake, snowflakeMarkup, VIEWBOX } from "../lib/render";
import { generateSnowflake, type GeneratedSnowflake } from "../lib/snowflake";
import { typeInto, type TypeOptions } from "../lib/typewriter";

const form = document.querySelector<HTMLFormElement>("[data-form]")!;
const input = document.querySelector<HTMLInputElement>("[data-input]")!;
const stage = document.querySelector<HTMLElement>("[data-stage]")!;
const svg = stage.querySelector<SVGSVGElement>("svg")!;
const root = svg.querySelector<SVGGElement>("[data-flake-root]")!;
const snowfall = document.querySelector<HTMLElement>("[data-snowfall]") ?? undefined;
const generateButton = document.querySelector<HTMLButtonElement>("[data-generate]")!;
const downloadButton = document.querySelector<HTMLButtonElement>("[data-download]")!;
const historyPanel = document.querySelector<HTMLElement>("#history-panel")!;
const historyList = historyPanel.querySelector<HTMLOListElement>("[data-history-list]")!;
const historyEmpty = historyPanel.querySelector<HTMLElement>("[data-history-empty]")!;

// 開発時のみ：?slow=4 で全体を 4 倍遅くして動きを確認できる
const overrides: AnimationOverrides = {};
if (import.meta.env.DEV) {
  const slow = Number(new URLSearchParams(location.search).get("slow"));
  if (slow > 0) overrides.timeScale = slow;
}

let current: AnimationHandle | null = null;
/** 表示中の結晶（ダウンロード用） */
let shown: { text: string; result: GeneratedSnowflake } | null = null;
let requestId = 0;

/** 生成アニメーション中は Generate を押せなくする（ラベルは CSS で切り替わる） */
function setGenerating(generating: boolean) {
  generateButton.disabled = generating;
  // ダウンロードは生成アニメーションが終わってから出す
  downloadButton.disabled = generating;
}

async function generate(text: string, { record = true } = {}) {
  const id = ++requestId;
  const result = await generateSnowflake(text);
  const { hash, snowflake } = result;
  // 連打された場合は最新の入力だけを反映する
  if (id !== requestId) return;

  current?.cancel();
  renderSnowflake(root, snowflake);
  svg.setAttribute("aria-label", `「${text}」から生成した雪の結晶`);
  // 背景の雪の降り方も入力ごとに決まるよう、ハッシュを seed として渡す
  svg.dataset.seed = hash;
  setGenerating(true);
  const handle = (current = animateSnowflake({ stage, svg, snowfall }, overrides));
  stage.dataset.state = "ready";
  shown = { text, result };
  if (record) addToHistory(text);
  await handle.finished;
  // 途中で次の生成に切り替わった（cancel でも finished は解決する）場合は戻さない
  if (handle === current) setGenerating(false);
}

// --- 打ち込み演出 ---------------------------------------------------------------

let typing: AbortController | null = null;

/** 入力欄に text を 1 文字ずつ打ち込んでから生成する */
async function typeAndGenerate(text: string, options?: { record?: boolean; typing?: TypeOptions }) {
  typing?.abort();
  const controller = (typing = new AbortController());
  if (!(await typeInto(input, text, controller.signal, options?.typing))) return;
  typing = null;
  void generate(text, options);
}

// 打ち込み中にユーザーが入力したら、演出はそこで止めてユーザーの入力を優先する
input.addEventListener("input", () => typing?.abort());

// --- ダウンロード ---------------------------------------------------------------

/** 完成形の結晶を SVG として保存する（アニメーションの途中でも完成形を書き出す） */
function download(text: string, { hash, snowflake }: GeneratedSnowflake) {
  const meta = { text, hash };
  downloadSvg(snowflakeFileName(meta), snowflakeSvgFile(snowflake, meta));
}

downloadButton.addEventListener("click", () => {
  if (shown) download(shown.text, shown.result);
});

// --- 履歴 ---------------------------------------------------------------------

const relativeTime = new Intl.RelativeTimeFormat("ja", { numeric: "auto" });
function formatAgo(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return relativeTime.format(-minutes, "minute");
  return relativeTime.format(-Math.round(minutes / 60), "hour");
}

async function historyItem(entry: HistoryEntry): Promise<HTMLLIElement> {
  const result = await generateSnowflake(entry.text);
  const label = entry.text === "" ? "（空の文字列）" : entry.text;
  const li = document.createElement("li");
  li.className = "history-row";

  // 項目全体：クリックで再生成
  const button = document.createElement("button");
  button.type = "button";
  button.className = "history-item";
  button.innerHTML =
    `<svg class="history-thumb" viewBox="${VIEWBOX}" aria-hidden="true">${snowflakeMarkup(result.snowflake)}</svg>` +
    `<span class="history-text"></span><span class="history-time"></span>`;
  // 入力テキストは HTML として解釈させない
  button.querySelector(".history-text")!.textContent = label;
  button.querySelector(".history-time")!.textContent = formatAgo(entry.at);
  button.addEventListener("click", () => {
    historyPanel.hidePopover();
    void typeAndGenerate(entry.text);
  });

  // 右端：再生成せずにその場で保存（ボタンの中にボタンは置けないので、横に並べる）
  const save = document.createElement("button");
  save.type = "button";
  save.className = "history-download";
  save.setAttribute("aria-label", `「${label}」の結晶を SVG で保存`);
  save.title = "SVG で保存";
  save.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v10m0 0-4-4m4 4 4-4M5.5 19.5h13"></path></svg>`;
  save.addEventListener("click", () => download(entry.text, result));

  li.append(button, save);
  return li;
}

async function renderHistory() {
  const entries = loadHistory();
  const items = await Promise.all(entries.map(historyItem));
  historyList.replaceChildren(...items);
  historyEmpty.hidden = entries.length > 0;
}

// 開くたびに最新の履歴で描き直す（期限切れもここで消える）
historyPanel.addEventListener("beforetoggle", (event) => {
  if ((event as ToggleEvent).newState === "open") void renderHistory();
});

// 単一行 input の Enter はフォームの暗黙送信になる（IME 変換確定の Enter では送信されない）
form.addEventListener("submit", (event) => {
  event.preventDefault();
  // 生成アニメーション中は Enter でも生成し直さない
  if (generateButton.disabled) return;
  typing?.abort();
  void generate(input.value);
});

// 背景のダイヤモンドダスト（入力に関係なく固定）
const diamondDust = document.querySelector<HTMLElement>("[data-diamond-dust]");
if (diamondDust) mountDiamondDust(diamondDust);
const twinkle = document.querySelector<HTMLElement>("[data-diamond-twinkle]");
if (twinkle) mountTwinkle(twinkle);

// --- 読み込み時の演出 ---------------------------------------------------------

/**
 * CSS の読み込み演出（global.css の --intro-*）で、入力欄の下線を引き終えるまで待つ。
 * 演出がない（動きを減らす設定・すでに終わっている）ときはすぐに解決する
 */
function introLineDrawn(): Promise<unknown> {
  const line = input.parentElement
    ?.getAnimations({ subtree: true })
    .find((a) => a instanceof CSSAnimation && a.animationName === "intro-line");
  return line ? line.finished.catch(() => undefined) : Promise.resolve();
}

/** 下線を引き終えてから打ち始めるまでの間（--intro-gap。ms で書く） */
const introGap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--intro-gap")) || 0;

// ?text=… があればその文字列から始める（入力欄の name と同じなので、JS なしでフォームを送った URL とも揃う）。
// 指定された文字列は履歴に残し、初期表示のサンプル（hello world）は残さない
const textParam = new URLSearchParams(location.search).get("text");
void typeAndGenerate(textParam ?? input.value, {
  record: textParam !== null,
  typing: { ready: introLineDrawn(), startDelay: introGap },
});
