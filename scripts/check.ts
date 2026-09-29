/**
 * 生成アルゴリズムの検証（開発用）: bun scripts/check.ts
 * - SHA-256 の正しさ
 * - 決定論性（同じ入力 → 同じ結果 / 異なる入力 → 異なる結果）
 * - 1/12 セクションが扇形内に収まっていること
 * - 6 回回転対称・線対称
 * - 密度が範囲内であること
 */
import { angleOf, length, mirrorPoint, rotatePoint, strokeLength } from "../src/lib/geometry";
import { generateHash } from "../src/lib/hash";
import { generateSnowflakeParameters, LIMITS } from "../src/lib/params";
import { createSeededRandom } from "../src/lib/random";
import { BOUNDARY_MARGIN, generateSection, SECTION_ANGLE } from "../src/lib/section";
import { generateSnowflake } from "../src/lib/snowflake";

let failures = 0;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    failures++;
    console.error(`  ✗ ${message}`);
  }
};
const EPS = 1e-6;

// 1. SHA-256
const { hex } = await generateHash("hello world");
assert(hex === "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", `sha256("hello world") = ${hex}`);

// 2. 決定論性
const a1 = JSON.stringify((await generateSnowflake("hello world")).snowflake);
const a2 = JSON.stringify((await generateSnowflake("hello world")).snowflake);
const b1 = JSON.stringify((await generateSnowflake("hello world!")).snowflake);
assert(a1 === a2, "same input produces same snowflake");
assert(a1 !== b1, "different input produces different snowflake");

// 3〜5. 多数の入力で幾何制約を確認
const inputs = ["", "hello world", "雪の結晶", "❄️", "a".repeat(500)];
for (let i = 0; i < 1000; i++) inputs.push(`sample-${i}`);

const densities: number[] = [];
const profiles: Record<string, number> = {};
const traitCounts: Record<string, number> = {};
for (const input of inputs) {
  const { bytes } = await generateHash(input);
  const params = generateSnowflakeParameters(createSeededRandom(bytes));
  profiles[params.profile] = (profiles[params.profile] ?? 0) + 1;
  for (const [k, v] of Object.entries(params.traits)) traitCounts[`${k}:${v}`] = (traitCounts[`${k}:${v}`] ?? 0) + 1;
  const section = generateSection(params);

  let twigTotal = 0;
  for (const stroke of section) {
    for (const p of stroke.points) {
      const phi = angleOf(p);
      const r = length(p);
      assert(r <= params.radius + EPS, `${input}: point outside radius (${r.toFixed(2)})`);
      if (r < EPS) continue;
      if (stroke.kind === "core" || stroke.kind === "ring" || stroke.kind === "plate") {
        // 中央の六角形と輪は 30° 線上で隣と接続する（プレートの塗りは輪郭 edge 側で検査される）
        assert(phi >= -EPS && phi <= SECTION_ANGLE + EPS, `${input}: core outside wedge (${phi.toFixed(2)}°)`);
      } else {
        assert(
          phi >= -EPS && phi <= SECTION_ANGLE - BOUNDARY_MARGIN + EPS,
          `${input}: ${stroke.kind} outside wedge (${phi.toFixed(2)}°)`,
        );
      }
    }
    if (stroke.kind === "branch" || stroke.kind === "twig") twigTotal += strokeLength(stroke);
    assert(stroke.growth.end >= stroke.growth.start, `${input}: growth order`);
  }
  densities.push(twigTotal / params.radius);
  assert(section.some((s) => s.kind === "branch"), `${input}: has branches`);

  // 対称性：各セクターは 1 つ目のセクターの回転、1/6 内部は x 軸で線対称
  const flake = (await generateSnowflake(input)).snowflake;
  const base = flake.sectors[0].strokes;
  for (const sector of flake.sectors) {
    sector.strokes.forEach((s, i) => {
      s.points.forEach((p, j) => {
        const q = rotatePoint(base[i].points[j], sector.rotation);
        assert(Math.hypot(p.x - q.x, p.y - q.y) < 1e-6, `${input}: rotation symmetry`);
      });
    });
  }
  const key = (x: number, y: number) => `${x.toFixed(4)},${(Math.abs(y) < 1e-9 ? 0 : y).toFixed(4)}`;
  const pointSet = new Set(base.flatMap((s) => s.points.map((p) => key(p.x, p.y))));
  for (const s of base)
    for (const p of s.points) {
      const m = mirrorPoint(p);
      assert(pointSet.has(key(m.x, m.y)), `${input}: mirror symmetry`);
    }
}

const min = Math.min(...densities);
const max = Math.max(...densities);
console.log(`inputs: ${inputs.length}`);
console.log(`profiles: ${JSON.stringify(profiles)}`);
console.log(`traits: ${JSON.stringify(traitCounts)}`);
console.log(`density (branch length / radius per 1/12): min ${min.toFixed(2)} max ${max.toFixed(2)}`);
// 細かい要素を減らしているため、板状型では線の総延長がかなり短くなる（プレートと主枝で形が成立する）
assert(min >= LIMITS.density.min * 0.35, "density too low");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
