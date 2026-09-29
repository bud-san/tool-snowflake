/**
 * 雪の結晶の生成アニメーション（Web Animations API）。
 *
 * 生成ロジックには依存せず、描画済み SVG の以下だけを参照する：
 *   - path.stroke の data-start / data-end（成長タイミング 0〜1）
 *   - path.fill（プレートの塗り）の data-start
 *   - .core-glow（中央の光）
 *
 * フェーズは TIMELINE に並べた順に実行される。各フェーズは開始時刻を受け取り、
 * 自分の Animation と所要時間を返すだけなので、追加・削除・並べ替えが容易。
 * タイミングや強度の値は animation-config.ts で調整する。
 */
import { mergeAnimationConfig, type AnimationConfig, type AnimationOverrides } from "./animation-config";
import { GLOW_FILTER } from "./render";

const SVG_NS = "http://www.w3.org/2000/svg";
/** GLOW_FILTER（url(#soft-glow)）が指すフィルター */
const GLOW_FILTER_SELECTOR = GLOW_FILTER.slice("url(".length, -1);
/** ぼかしを徐々に強めている間だけ使う、soft-glow の複製 */
const GLOW_RAMP_ID = "soft-glow-ramp";
import { startSnowfall } from "./snowfall";

export interface AnimationTarget {
  /** 回転・拡大させる要素（SVG を包む正方形の要素） */
  stage: HTMLElement;
  svg: SVGSVGElement;
  /** 背景の雪を降らせるレイヤー（省略時は降らせない） */
  snowfall?: HTMLElement;
}

export interface AnimationHandle {
  cancel(): void;
  finished: Promise<void>;
}

interface PhaseContext extends AnimationTarget {
  cfg: AnimationConfig;
  strokes: SVGPathElement[];
  fills: SVGPathElement[];
  glow: SVGElement | null;
  /** 線と塗りをまとめた <g class="lines">（ぼかしの filter がかかっている） */
  lines: SVGGElement | null;
  /** フェーズ同士で共有する時刻（例：grow の開始時刻）。並行フェーズが参照する */
  marks: Record<string, number>;
  /** timeScale を掛けた ms */
  ms(value: number): number;
}

interface PhaseResult {
  animations: Animation[];
  duration: number;
  /** 無限に続くアニメーション（finished の対象外） */
  ambient?: boolean;
  /** 中断時の後片付け。省略時は animations を cancel する */
  dispose?: () => void;
}

type Phase = (ctx: PhaseContext, startAt: number) => PhaseResult;

interface TimelineStep {
  name: string;
  phase: Phase;
  /** 直前のフェーズ終了からのずれ（ms、負の値で重ねる） */
  offset?: (cfg: AnimationConfig) => number;
}

// --- フェーズ ---------------------------------------------------------------

/** 1. 中央の核の光が現れる */
const playCore: Phase = (ctx, startAt) => {
  const { core } = ctx.cfg;
  const duration = ctx.ms(core.duration);
  const animations = ctx.glow
    ? [
        ctx.glow.animate(
          [
            { opacity: 0, scale: core.fromScale },
            { opacity: 1, scale: 1 },
          ],
          { delay: startAt, duration, easing: core.easing, fill: "backwards" },
        ),
      ]
    : [];
  return { animations, duration };
};

/**
 * 成長の前線が位置 p に届く時刻（0〜1）。
 * curve（時間 → 位置）の逆関数を二分探索で求める。
 */
function timeAtProgress(p: number, curve: (t: number) => number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (curve(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 2. 中心から外側へ線を描く（stroke-dashoffset） */
const playGrow: Phase = (ctx, startAt) => {
  const { grow } = ctx.cfg;
  const total = ctx.ms(grow.duration);
  ctx.marks.grow = startAt;
  // 伸びている間は毎フレーム線が描き直されるため、ぼかしの filter を外して描画を軽くする（playGlow で戻す）
  ctx.lines?.removeAttribute("filter");

  const animations = ctx.strokes.map((path) => {
    const start = Number(path.dataset.start ?? 0);
    const end = Number(path.dataset.end ?? 1);
    const t0 = timeAtProgress(start, grow.curve);
    const t1 = timeAtProgress(end, grow.curve);
    const span = Math.max(t1 - t0, 1e-4);

    // 線の各区間が前線の位置に合わせて描かれるよう、curve に沿ってキーフレームを置く
    const keyframes: Keyframe[] = [];
    for (let i = 0; i <= grow.samples; i++) {
      const k = i / grow.samples;
      const t = timeAtProgress(start + (end - start) * k, grow.curve);
      keyframes.push({
        offset: Math.min(1, Math.max(0, (t - t0) / span)),
        strokeDasharray: "1 2",
        strokeDashoffset: 1 - k,
        opacity: grow.fadeInHead && i === 0 ? 0 : 1,
      });
    }

    return path.animate(keyframes, {
      delay: startAt + t0 * total,
      duration: Math.max(1, span * total),
      easing: "linear",
      fill: "backwards",
    });
  });

  return { animations, duration: total };
};

/**
 * 2'. プレートの塗りを、輪郭が描き終わった時刻からふわっと出す。
 * grow と並行して進むため、タイムライン上の所要時間は 0 を返す。
 */
const playFill: Phase = (ctx) => {
  const { grow, fill } = ctx.cfg;
  const growStart = ctx.marks.grow ?? 0;
  const animations = ctx.fills.map((path) => {
    const appearAt = timeAtProgress(Number(path.dataset.start ?? 1), grow.curve) * ctx.ms(grow.duration);
    return path.animate([{ opacity: 0 }, { opacity: 1 }], {
      delay: growStart + appearAt + ctx.ms(fill.delay),
      duration: ctx.ms(fill.duration),
      easing: fill.easing,
      fill: "backwards",
    });
  });
  return { animations, duration: 0 };
};

/**
 * 2''. grow で外したぼかしを、伸び終わり際から徐々に強めて戻す。
 *
 * soft-glow は「ぼかした線」を元の線の下に重ねるフィルター。ぼかし量だけを 0 から上げると、
 * 付けた瞬間に半透明の塗りが二重に重なって一段明るくなるため、ぼかした層の濃さ（feFuncA の slope）も
 * 0 から上げる複製（ランプ用）を一時的に使う。最大になった時点で元の soft-glow に戻すので、見た目は切り替わらない。
 * ランプ用のフィルターは別の <defs> に置き、SVG の書き出し（最初の <defs> を使う）には含めない。
 */
const playGlow: Phase = (ctx) => {
  const { grow, glow } = ctx.cfg;
  const source = ctx.svg.querySelector<SVGFilterElement>(GLOW_FILTER_SELECTOR);
  const blur = source?.querySelector("feGaussianBlur");
  if (!ctx.lines || !source || !blur) return { animations: [], duration: 0 };
  const lines = ctx.lines;
  const maxDeviation = Number(blur.getAttribute("stdDeviation") ?? 1);

  const defs = document.createElementNS(SVG_NS, "defs");
  const ramp = document.createElementNS(SVG_NS, "filter");
  ramp.id = GLOW_RAMP_ID;
  for (const name of ["x", "y", "width", "height"]) {
    const value = source.getAttribute(name);
    if (value) ramp.setAttribute(name, value);
  }
  ramp.innerHTML =
    `<feGaussianBlur in="SourceGraphic" stdDeviation="0" result="blur"></feGaussianBlur>` +
    `<feComponentTransfer in="blur" result="glow"><feFuncA type="linear" slope="0"></feFuncA></feComponentTransfer>` +
    `<feMerge><feMergeNode in="glow"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>`;
  defs.append(ramp);
  ctx.svg.append(defs);
  const rampBlur = ramp.querySelector("feGaussianBlur")!;
  const rampAlpha = ramp.querySelector("feFuncA")!;

  // easing（CSS の文字列）を JS で評価するため、対象のない Animation を時計として使い、進み具合だけを読む
  const startAt = Math.max(0, (ctx.marks.grow ?? 0) + ctx.ms(grow.duration) + ctx.ms(glow.offset));
  const clock = new Animation(
    new KeyframeEffect(null, [], { delay: startAt, duration: ctx.ms(glow.duration), easing: glow.easing, fill: "both" }),
  );
  clock.play();

  // 毎フレームの書き換えは、ぼかしを強め始めてから最大になるまでの間だけ行う
  let frame = 0;
  const tick = () => {
    const progress = clock.effect?.getComputedTiming().progress ?? 0;
    rampBlur.setAttribute("stdDeviation", String(maxDeviation * progress));
    rampAlpha.setAttribute("slope", String(progress));
    frame = requestAnimationFrame(tick);
  };
  const timer = setTimeout(() => {
    lines.setAttribute("filter", `url(#${GLOW_RAMP_ID})`);
    tick();
  }, startAt);

  const finish = () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    lines.setAttribute("filter", GLOW_FILTER);
    defs.remove();
  };
  // 最後まで進んだら元の soft-glow に戻す（中断時は cancel で reject されるので dispose 側で戻す）
  clock.finished.then(finish, () => undefined);

  return {
    animations: [clock],
    duration: 0,
    dispose: () => {
      clock.cancel();
      finish();
    },
  };
};

/**
 * 3. 完成時にわずかに光って膨らむ。
 * 上がる区間と下がる区間に別々の easing をかけ、ピークで速度が急に反転しないようにする。
 */
const playEmphasis: Phase = (ctx, startAt) => {
  const { emphasis: e } = ctx.cfg;
  const duration = ctx.ms(e.duration);
  // 区間ごとの easing はキーフレーム側で指定し、全体は linear にする
  const timing: KeyframeAnimationOptions = { delay: startAt, duration, easing: "linear" };
  const filter = (brightness: number, radius: number) =>
    `brightness(${brightness}) drop-shadow(0 0 ${radius}px ${e.glowColor})`;
  const bell = <T extends Keyframe>(rest: T, peak: T): Keyframe[] => [
    { ...rest, offset: 0, easing: e.riseEasing },
    { ...peak, offset: e.peakAt, easing: e.fallEasing },
    { ...rest, offset: 1 },
  ];

  const animations = [
    ctx.stage.animate(bell({ scale: 1 }, { scale: e.peakScale }), timing),
    ctx.svg.animate(bell({ filter: filter(1, 0) }, { filter: filter(e.peakBrightness, e.glowRadius) }), timing),
  ];
  return { animations, duration };
};

/** 4. 静止 */
const playHold: Phase = (ctx) => ({ animations: [], duration: ctx.ms(ctx.cfg.hold.duration) });

/** 5. ゆっくり回転して元の角度で止まる */
const playRotate: Phase = (ctx, startAt) => {
  const { rotate } = ctx.cfg;
  const duration = ctx.ms(rotate.duration);
  const animation = ctx.stage.animate([{ rotate: "0deg" }, { rotate: `${360 * rotate.turns}deg` }], {
    delay: startAt,
    duration,
    easing: rotate.easing,
    // 終了後は基準値 rotate: 0deg に戻る（60° の倍数だけ回すので、戻っても見た目は変わらない）
    fill: "none",
  });
  return { animations: [animation], duration };
};

/** 6. 背景に、生成した結晶の小さなコピーを雪のように降らせる */
const playSnowfall: Phase = (ctx, startAt) => {
  if (!ctx.snowfall) return { animations: [], duration: 0 };
  const run = startSnowfall(ctx.snowfall, ctx.svg, ctx.cfg.snowfall, { startAt, ms: ctx.ms, still: false });
  return { animations: run.animations, duration: 0, ambient: true, dispose: run.dispose };
};

/** reduced motion：背景の雪は動かさず、静かに置くだけ */
const placeStillSnow: Phase = (ctx, startAt) => {
  if (!ctx.snowfall) return { animations: [], duration: 0 };
  const run = startSnowfall(ctx.snowfall, ctx.svg, ctx.cfg.snowfall, { startAt, ms: ctx.ms, still: true });
  return { animations: run.animations, duration: 0, dispose: run.dispose };
};

/** reduced motion：完成形をフェードで表示するだけ */
const playFade: Phase = (ctx, startAt) => {
  const { reduced } = ctx.cfg;
  const duration = ctx.ms(reduced.duration);
  const animation = ctx.stage.animate([{ opacity: 0 }, { opacity: 1 }], {
    delay: startAt,
    duration,
    easing: reduced.easing,
    fill: "backwards",
  });
  return { animations: [animation], duration };
};

// --- タイムライン -----------------------------------------------------------

export const TIMELINE: TimelineStep[] = [
  { name: "core", phase: playCore },
  { name: "grow", phase: playGrow, offset: (cfg) => cfg.grow.offset },
  { name: "fill", phase: playFill },
  { name: "glow", phase: playGlow },
  { name: "emphasis", phase: playEmphasis, offset: (cfg) => cfg.emphasis.offset },
  { name: "hold", phase: playHold, offset: (cfg) => cfg.hold.offset },
  { name: "rotate", phase: playRotate, offset: (cfg) => cfg.rotate.offset },
  { name: "snowfall", phase: playSnowfall, offset: (cfg) => cfg.snowfall.offset },
];

export const REDUCED_TIMELINE: TimelineStep[] = [
  { name: "fade", phase: playFade },
  { name: "snowfall", phase: placeStillSnow },
];

export function animateSnowflake(target: AnimationTarget, overrides?: AnimationOverrides): AnimationHandle {
  const cfg = mergeAnimationConfig(overrides);
  const ctx: PhaseContext = {
    ...target,
    cfg,
    strokes: Array.from(target.svg.querySelectorAll<SVGPathElement>("path.stroke")),
    fills: Array.from(target.svg.querySelectorAll<SVGPathElement>("path.fill")),
    glow: target.svg.querySelector<SVGElement>(".core-glow"),
    lines: target.svg.querySelector<SVGGElement>(".lines"),
    marks: {},
    ms: (value) => value * cfg.timeScale,
  };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const steps = reduced ? REDUCED_TIMELINE : TIMELINE;

  const results: PhaseResult[] = [];
  let cursor = 0;
  for (const step of steps) {
    const startAt = Math.max(0, cursor + ctx.ms(step.offset?.(cfg) ?? 0));
    const result = step.phase(ctx, startAt);
    results.push(result);
    cursor = startAt + result.duration;
  }

  const finite = results.filter((r) => !r.ambient).flatMap((r) => r.animations);
  return {
    cancel: () => results.forEach((r) => (r.dispose ? r.dispose() : r.animations.forEach((a) => a.cancel()))),
    // cancel 時は reject されるので握りつぶす
    finished: Promise.all(finite.map((a) => a.finished)).then(
      () => undefined,
      () => undefined,
    ),
  };
}
