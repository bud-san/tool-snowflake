/**
 * 1/12 → 線対称 → 1/6 → 60°×6 回転 で雪の結晶全体を組み立てる。
 * 6 本の枝を個別に生成せず、必ず同じ 1/6 セクションを回転配置する。
 */
import { mapStroke, mirrorPoint, rotatePoint, type Stroke } from "./geometry";
import type { SnowflakeParameters } from "./params";
import { generateSection } from "./section";

export interface Sector {
  rotation: number;
  strokes: Stroke[];
}

export interface Snowflake {
  params: SnowflakeParameters;
  sectors: Sector[];
}

/** 1/12 セクションを 0° 軸で反転して 1/6 セクションにする（軸上の要素は複製しない） */
export function mirrorSection(section: Stroke[]): Stroke[] {
  const mirrored = section.filter((s) => !s.onAxis).map((s) => mapStroke(s, mirrorPoint));
  return [...section, ...mirrored];
}

/** growth を 0〜1 に正規化する（アニメーションはこの値だけを参照する） */
function normalizeGrowth(strokes: Stroke[]): Stroke[] {
  const max = Math.max(...strokes.map((s) => s.growth.end));
  return strokes.map((s) => ({ ...s, growth: { start: s.growth.start / max, end: s.growth.end / max } }));
}

export function createSnowflake(params: SnowflakeParameters): Snowflake {
  const twelfth = generateSection(params);
  const sixth = normalizeGrowth(mirrorSection(twelfth));
  const sectors = [0, 60, 120, 180, 240, 300].map((rotation) => ({
    rotation,
    strokes: sixth.map((s) => mapStroke(s, (p) => rotatePoint(p, rotation))),
  }));
  return { params, sectors };
}
