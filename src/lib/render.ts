/**
 * 雪の結晶データを SVG に描画する。
 * 各 stroke は <path pathLength="1">（塗りは <path class="fill">）として出力し、成長タイミングを data 属性に持たせる。
 * （アニメーションは data-start / data-end だけを参照する）
 */
import type { Stroke } from "./geometry";
import type { Snowflake } from "./symmetry";

export const VIEWBOX = "-100 -100 200 200";

/** <g class="lines"> にかけるぼかし（成長アニメーション中は animate.ts が一時的に外す） */
export const GLOW_FILTER = "url(#soft-glow)";

const n = (v: number) => (Math.round(v * 100) / 100).toString();

function pathMarkup(stroke: Stroke): string {
  const d = stroke.points.map((p, i) => `${i === 0 ? "M" : "L"}${n(p.x)} ${n(p.y)}`).join(" ");
  const timing = `data-start="${stroke.growth.start.toFixed(4)}" data-end="${stroke.growth.end.toFixed(4)}"`;
  // 塗り：線の後ろに薄く敷くプレート
  if (stroke.fill) return `<path class="fill fill-${stroke.kind}" d="${d} Z" ${timing}></path>`;
  return `<path class="stroke stroke-${stroke.kind}" d="${d}" stroke-width="${n(stroke.width)}" pathLength="1" ${timing}></path>`;
}

/** <g data-flake-root> の中身となるマークアップ（SSR と クライアント双方で使用） */
export function snowflakeMarkup(flake: Snowflake): string {
  const coreGlow = `<circle class="core-glow" r="${n(flake.params.core.radius * 1.6)}" fill="url(#core-glow)"></circle>`;
  const sectors = flake.sectors
    .map((sector) => `<g class="sector" data-rotation="${sector.rotation}">${sector.strokes.map(pathMarkup).join("")}</g>`)
    .join("");
  return `${coreGlow}<g class="lines" filter="${GLOW_FILTER}">${sectors}</g>`;
}

export function renderSnowflake(root: SVGGElement, flake: Snowflake): void {
  root.innerHTML = snowflakeMarkup(flake);
}
