/**
 * 雪の結晶を SVG ファイルとして書き出す（ブラウザ内で完結し、外部には送らない）。
 *
 * 描画はページと同じ snowflakeMarkup を使う。線のぼかし（soft-glow のフィルター）と中央の光（core-glow）は
 * 画面演出用なので書き出さず、線と塗りだけのくっきりした結晶として保存する。
 * 色は CSS から読み取って属性として埋め込むので、ページの CSS がなくても同じ見た目になる。
 * 背景は透明。成長アニメーションの途中でも、常に完成形を書き出す。
 */
import { snowflakeMarkup, VIEWBOX } from "./render";
import type { Snowflake } from "./symmetry";

const SVG_NS = "http://www.w3.org/2000/svg";
/** 書き出す SVG の表示サイズ（px）。ベクターなので拡大しても劣化しない */
const EXPORT_SIZE = 1024;

export interface ExportMeta {
  /** 入力テキスト（SVG の <title> に入れる） */
  text: string;
  /** SHA-256（SVG の <desc> に入れる） */
  hash: string;
}

/** CSS に依存しない、単体で開ける SVG の文字列を作る */
export function snowflakeSvgFile(flake: Snowflake, meta: ExportMeta): string {
  // 色を CSS から読み取るため、いったん画面外に置いて計算させる
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", VIEWBOX);
  svg.style.cssText = "position:fixed;left:-10000px;top:0;width:10px;height:10px;visibility:hidden";
  svg.innerHTML = `<g>${snowflakeMarkup(flake)}</g>`;
  document.body.append(svg);

  // 画面演出用の中央の光と、ぼかしのフィルターの参照は外す（定義は書き出さないので、参照だけが残らないようにする）
  svg.querySelector(".core-glow")?.remove();
  for (const el of svg.querySelectorAll("[filter]")) el.removeAttribute("filter");

  for (const path of svg.querySelectorAll<SVGPathElement>("path")) {
    const style = getComputedStyle(path);
    if (path.classList.contains("fill")) {
      path.setAttribute("fill", style.fill);
      path.setAttribute("fill-opacity", style.fillOpacity);
    } else {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", style.stroke);
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.removeAttribute("pathLength");
    }
    // アニメーション用の情報は書き出さない
    path.removeAttribute("class");
    path.removeAttribute("data-start");
    path.removeAttribute("data-end");
  }
  for (const el of svg.querySelectorAll("[class]")) el.removeAttribute("class");

  svg.removeAttribute("style");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("width", String(EXPORT_SIZE));
  svg.setAttribute("height", String(EXPORT_SIZE));

  // 入力テキストとハッシュを記録しておく（textContent なので特殊文字も安全にエスケープされる）
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = meta.text;
  const desc = document.createElementNS(SVG_NS, "desc");
  desc.textContent = `Hash Snowflake / SHA-256: ${meta.hash}`;
  svg.prepend(title, desc);

  const source = new XMLSerializer().serializeToString(svg);
  svg.remove();
  return `<?xml version="1.0" encoding="UTF-8"?>\n${source}\n`;
}

/** 入力テキストからファイル名を作る（例：snowflake-hello-world-b94d27b9.svg） */
export function snowflakeFileName(meta: ExportMeta): string {
  const slug = meta.text
    .normalize("NFKC")
    // 文字と数字以外（空白・記号・絵文字など）は区切りにする
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  // 同じ見た目のテキストでも区別できるよう、ハッシュの先頭を付ける
  return `snowflake-${slug ? `${slug}-` : ""}${meta.hash.slice(0, 8)}.svg`;
}

/** ブラウザ標準のダウンロードで保存する */
export function downloadSvg(fileName: string, source: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // ダウンロードの開始を待ってから解放する
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
