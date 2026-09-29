/**
 * seeded random から雪の結晶のパラメータを決める。
 *
 * 個体差がはっきり出るよう、見た目を大きく左右する要素は連続値ではなく
 * 離散的な「特徴（traits）」として選ぶ。細かな揺らぎはその上に小さく乗せる。
 * すべての値は LIMITS の範囲内に制限し、どの seed でも破綻しないようにする。
 * 実際の長さ（境界クランプ後の値）は section.ts が幾何計算で確定する。
 */
import type { SeededRandom } from "./random";

export type CoreStyle = "hex" | "double" | "star" | "spoke";
/** 小枝の付き方の型。自然の雪の代表的な形をざっくりモデル化したもの */
export type BranchProfile = "stellar" | "fern" | "sector";
export type SizeClass = "small" | "medium" | "large";
export type Weight = "delicate" | "standard" | "bold";
/** 主枝の先端：丸 / 二股 / 矢じり / 六角プレート */
export type ArmTip = "round" | "fork" | "arrow" | "plate";
/** 小枝の先端：なし / 六角プレート / 隣の腕と繋がる輪 */
export type BranchTip = "none" | "plate" | "ring";
/** 主枝の胴：線のみ / 扇形プレート付き */
export type ArmBody = "plain" | "sector";
export type CoreScale = "small" | "normal" | "large";

export interface Traits {
  size: SizeClass;
  weight: Weight;
  armTip: ArmTip;
  branchTip: BranchTip;
  armBody: ArmBody;
  coreScale: CoreScale;
}

export interface CoreParams {
  style: CoreStyle;
  radius: number;
  /** double / star の内側の半径比 */
  innerRatio: number;
  width: number;
  /** 中央を薄く塗った六角プレートにする */
  filled: boolean;
}

export interface TwigParams {
  /** 小枝上の位置（0 = 付け根, 1 = 先端） */
  u: number;
  /** outer: 主枝と平行に外向き / inner: 中心側へ戻る向き */
  side: "outer" | "inner";
  /** 小枝の長さに対する比 */
  lengthFactor: number;
  angleJitter: number;
}

export interface BranchParams {
  /** 主枝上の位置（半径に対する比） */
  t: number;
  /** 主枝からの角度（deg） */
  angle: number;
  /** 希望する長さ（半径に対する比）。境界制約でさらに短くなることがある */
  lengthFactor: number;
  /** 主枝の太さに対する比（未使用：線の太さは lineWidth に統一） */
  widthFactor: number;
  twigs: TwigParams[];
  /** 主枝先端の装飾として追加された枝（密度計算・装飾の対象外） */
  isTip?: boolean;
}

export interface SnowflakeParameters {
  traits: Traits;
  radius: number;
  /**
   * 線の太さ。1 つの結晶の中ではすべての線をこの太さにそろえる。
   * LIMITS.uniformLineWidth が数値なら全結晶で共通、null なら結晶ごとの違い（繊細・標準・太め）を残す
   */
  lineWidth: number;
  /** 線の太さの基準（lineWidth の元になる値） */
  mainWidth: number;
  /**
   * 以下の太さに関する値（mainTaper / widthFactor / core.width）は、線の太さを均一にしたため描画には使っていない。
   * 生成時に乱数を消費する順番を変えると全ての結晶の形が変わってしまうため、値の生成は残している
   */
  /** 主枝先端の太さ比（未使用） */
  mainTaper: number;
  /** 主枝の開始半径（0 なら中心から） */
  armStart: number;
  core: CoreParams;
  profile: BranchProfile;
  branches: BranchParams[];
  /** 主枝先端の六角プレートの大きさ（半径に対する比） */
  armTipPlate: number;
  /** 小枝先端の六角プレートの大きさ（小枝の長さに対する比） */
  branchPlate: number;
  /** 主枝の扇形プレート（範囲は半径に対する比） */
  sectorPlate: { from: number; to: number; height: number };
  /** 小枝の総延長の目標範囲（半径に対する比、1/12 セクションあたり） */
  density: { min: number; max: number };
}

/** 生成パラメータの許容範囲。見た目の調整は主にここで行う */
export const LIMITS = {
  size: {
    small: { weight: 0.3, radius: [62, 70] },
    medium: { weight: 0.4, radius: [75, 82] },
    large: { weight: 0.3, radius: [86, 91] },
  },
  weight: {
    delicate: { weight: 0.3, scale: 0.62 },
    standard: { weight: 0.45, scale: 1 },
    bold: { weight: 0.25, scale: 1.45 },
  },
  mainWidth: [2.0, 2.8],
  /** mainWidth に対する、実際に描く線の太さの比 */
  lineWidthRatio: 0.7,
  /**
   * 全結晶で共通の線の太さ。数値を入れると、どの結晶もこの太さになる（「繊細・標準・太め」の違いを使わない）。
   * null にすると、結晶ごとの太さ（mainWidth × lineWidthRatio）に戻る
   */
  uniformLineWidth: 1.7 as number | null,
  mainTaper: [0.4, 0.75],
  branchAngle: [57, 63],
  branchAngleJitter: 2,
  tEnd: 0.88,
  profiles: {
    stellar: { weight: 0.4, count: [3, 4], reach: [0.38, 0.5], width: [0.5, 0.7], twigChance: 0.55, twigMax: 1 },
    fern: { weight: 0.3, count: [4, 5], reach: [0.24, 0.34], width: [0.45, 0.62], twigChance: 0.15, twigMax: 1 },
    sector: { weight: 0.3, count: [2, 4], reach: [0.11, 0.18], width: [0.7, 0.9], twigChance: 0, twigMax: 1 },
  },
  density: { min: 0.8, max: 4.2 },
} as const;

/** 1 つの結晶に同時に付く目立つ装飾（大きな中央・扇形プレート・先端プレート・枝先装飾）の上限 */
const MAX_ORNAMENTS = 2;

type Range = readonly [number, number];
const within = (rng: SeededRandom, [min, max]: Range) => rng.range(min, max);
const pickWeighted = <K extends string>(rng: SeededRandom, table: Record<K, { weight: number }>): K =>
  rng.weighted((Object.keys(table) as K[]).map((key) => [key, table[key].weight] as const));

/** 主枝上の位置 x(0..1) に応じた小枝の長さの包絡線 */
const ENVELOPES: Record<BranchProfile, (x: number) => number> = {
  // 中ほどが最も長い樹枝状
  stellar: (x) => Math.sin(Math.PI * (0.25 + 0.6 * x)),
  // 内側ほど長いシダ状
  fern: (x) => 1 - 0.55 * x,
  // 短くほぼ均一な板状
  sector: (x) => 0.9 + 0.1 * Math.sin(Math.PI * x),
};

function chooseTraits(rng: SeededRandom, profile: BranchProfile): Traits {
  const size = pickWeighted(rng, LIMITS.size);
  const weight = pickWeighted(rng, LIMITS.weight);

  const armTip = rng.weighted<ArmTip>([
    ["round", 0.25],
    ["fork", 0.25],
    ["arrow", 0.2],
    ["plate", 0.3],
  ]);
  // 板状型は胴にプレートを持ちやすく、樹枝型は枝先に装飾を持ちやすい
  const armBody = rng.weighted<ArmBody>([
    ["plain", profile === "sector" ? 0.35 : 0.7],
    ["sector", profile === "sector" ? 0.65 : 0.3],
  ]);
  const branchTip = rng.weighted<BranchTip>([
    ["none", armBody === "sector" ? 0.6 : 0.35],
    ["plate", profile === "fern" ? 0.1 : 0.3],
    ["ring", profile === "stellar" ? 0.25 : 0.15],
  ]);
  const coreScale = rng.weighted<CoreScale>([
    ["small", 0.3],
    ["normal", 0.4],
    ["large", 0.3],
  ]);

  const traits: Traits = { size, weight, armTip, branchTip, armBody, coreScale };

  // 主枝先端と枝先の両方がプレートだと、六角形が寄り集まって塊に見えるため避ける
  if (traits.armTip === "plate" && traits.branchTip === "plate") traits.armTip = "round";

  // 装飾が重なりすぎないよう、目立つ装飾は MAX_ORNAMENTS 個までにする（リストの先頭のものから外す）
  const ornaments: [() => boolean, () => void][] = [
    [() => traits.coreScale === "large", () => (traits.coreScale = "normal")],
    [() => traits.armBody === "sector", () => (traits.armBody = "plain")],
    [() => traits.armTip === "plate", () => (traits.armTip = "round")],
    [() => traits.branchTip !== "none", () => (traits.branchTip = "none")],
  ];
  let active = ornaments.filter(([has]) => has()).length;
  for (const [has, drop] of ornaments) {
    if (active <= MAX_ORNAMENTS) break;
    if (has()) {
      drop();
      active--;
    }
  }
  return traits;
}

export function generateSnowflakeParameters(rng: SeededRandom): SnowflakeParameters {
  const profile = pickWeighted(rng, LIMITS.profiles);
  const spec = LIMITS.profiles[profile];
  const traits = chooseTraits(rng, profile);
  const weightScale = LIMITS.weight[traits.weight].scale;

  const radius = within(rng, LIMITS.size[traits.size].radius);
  const mainWidth = (within(rng, LIMITS.mainWidth) + (profile === "sector" ? 0.3 : 0)) * weightScale;
  const mainTaper = within(rng, LIMITS.mainTaper);

  const coreStyle = rng.weighted<CoreStyle>([
    ["hex", 0.35],
    ["double", 0.25],
    ["star", 0.2],
    ["spoke", 0.2],
  ]);
  const coreRatio = { small: [0.06, 0.09], normal: [0.11, 0.15], large: [0.2, 0.26] } as const;
  const core: CoreParams = {
    style: coreStyle,
    radius: radius * within(rng, coreRatio[traits.coreScale]),
    innerRatio: rng.range(0.45, 0.6),
    width: rng.range(1.0, 1.5) * Math.sqrt(weightScale),
    filled: traits.coreScale === "large",
  };
  const armStart = coreStyle === "spoke" ? 0 : core.radius;

  const armTipPlate = rng.range(0.08, 0.12);
  // 主枝先端がプレートのときは、小枝がプレートに重ならないよう手前で止める
  const tEnd = traits.armTip === "plate" ? Math.min(LIMITS.tEnd, 1 - armTipPlate * 2.6) : LIMITS.tEnd;

  // 小枝の位置：等間隔＋ジッター（最小間隔を保つ）
  const count = rng.int(spec.count[0], spec.count[1]);
  // 中心付近に短い枝が密集しないよう、小枝は半径の 3 割より外側から始める
  const tStart = Math.max(0.3, core.radius / radius + 0.1);
  const spacing = (tEnd - tStart) / Math.max(1, count - 1);
  const baseAngle = within(rng, LIMITS.branchAngle);
  const reach = within(rng, spec.reach);
  const envelope = ENVELOPES[profile];
  const twigSide = rng.weighted<TwigParams["side"]>([
    ["outer", 0.7],
    ["inner", 0.3],
  ]);

  const branches: BranchParams[] = [];
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 0.5 : i / (count - 1);
    const t = tStart + i * spacing + rng.range(-0.2, 0.2) * spacing;

    const twigs: TwigParams[] = [];
    if (rng.chance(spec.twigChance)) {
      const n = rng.int(1, spec.twigMax);
      for (let k = 0; k < n; k++) {
        const slot = n === 1 ? [0.35, 0.7] : k === 0 ? [0.3, 0.5] : [0.6, 0.8];
        twigs.push({
          u: rng.range(slot[0], slot[1]),
          side: rng.chance(0.8) ? twigSide : twigSide === "outer" ? "inner" : "outer",
          lengthFactor: rng.range(0.32, 0.48),
          angleJitter: rng.range(-3, 3),
        });
      }
    }

    branches.push({
      t: Math.min(t, tEnd),
      angle: baseAngle + rng.range(-LIMITS.branchAngleJitter, LIMITS.branchAngleJitter),
      lengthFactor: reach * envelope(x) * rng.range(0.85, 1.1),
      widthFactor: within(rng, spec.width),
      twigs,
    });
  }

  // 主枝先端の装飾
  if (traits.armTip === "fork") {
    branches.push({
      t: rng.range(0.91, 0.95),
      angle: baseAngle,
      lengthFactor: rng.range(0.07, 0.1),
      widthFactor: 0.6,
      twigs: [],
      isTip: true,
    });
  } else if (traits.armTip === "arrow") {
    branches.push({
      t: rng.range(0.86, 0.9),
      angle: rng.range(36, 44),
      lengthFactor: rng.range(0.12, 0.16),
      widthFactor: 0.7,
      twigs: [],
      isTip: true,
    });
  }

  const sectorFrom = Math.max(armStart / radius, 0.08) + rng.range(0, 0.06);
  return {
    traits,
    radius,
    lineWidth: LIMITS.uniformLineWidth ?? mainWidth * LIMITS.lineWidthRatio,
    mainWidth,
    mainTaper,
    armStart,
    core,
    profile,
    branches,
    armTipPlate,
    branchPlate: rng.range(0.28, 0.4),
    sectorPlate: {
      from: sectorFrom,
      to: sectorFrom + rng.range(0.25, 0.45),
      height: rng.range(0.08, 0.14),
    },
    density: { ...LIMITS.density },
  };
}
