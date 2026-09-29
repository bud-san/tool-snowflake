/**
 * 生成アニメーションの設定。タイミング・easing・強度の調整はこのファイルだけで行う。
 *
 * 時間の単位はすべて ms。
 * タイムライン（animate.ts の TIMELINE）は以下の順で進む：
 *
 *   core ─┐
 *         └ grow（core の途中から開始：grow.offset）
 *            ├ fill（grow と並行。各プレートの輪郭が描き終わった順に塗りが現れる）
 *            └ emphasis → hold → rotate → 停止
 *                                      └ snowfall（回転の終わり際から、背景で雪が降り続ける）
 *
 * 初期値での総尺：約 4 秒
 */

/** CSS / WAAPI で使う easing */
export const EASE = {
  /** 静かで上品な減速（Premium） */
  premium: "cubic-bezier(0.4, 0, 0.2, 1)",
  /** 画面内での移動・回転用の ease-in-out */
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  /** 減速（ease-out）。動き始めが速く、なめらかに止まる */
  out: "cubic-bezier(0.25, 1, 0.5, 1)",
  /** ゆるやかな sine 系 ease-in-out */
  sine: "cubic-bezier(0.37, 0, 0.63, 1)",
} as const;

/**
 * 成長の進み方（時間 t: 0〜1 → 成長の前線の位置 p: 0〜1）。
 * 単調増加であれば任意の関数を使える。
 */
export type GrowthCurve = (t: number) => number;

export const GROWTH_CURVES = {
  linear: (t: number) => t,
  /** 始めは速く、外側でゆっくり止まる */
  easeOutQuad: (t: number) => 1 - (1 - t) ** 2,
  easeOutCubic: (t: number) => 1 - (1 - t) ** 3,
  /** 中心からふわっと始まり、外側でゆっくり止まる */
  easeInOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
} satisfies Record<string, GrowthCurve>;

export interface AnimationConfig {
  timeScale: number;
  core: { duration: number; easing: string; fromScale: number };
  grow: { offset: number; duration: number; curve: GrowthCurve; samples: number; fadeInHead: boolean };
  fill: { delay: number; duration: number; easing: string };
  glow: { offset: number; duration: number; easing: string };
  emphasis: {
    offset: number;
    duration: number;
    peakAt: number;
    riseEasing: string;
    fallEasing: string;
    peakScale: number;
    peakBrightness: number;
    glowRadius: number;
    glowColor: string;
  };
  hold: { offset: number; duration: number };
  rotate: { offset: number; duration: number; easing: string; turns: number };
  snowfall: {
    offset: number;
    count: number;
    center: { width: number; density: number };
    size: [number, number];
    fallDuration: [number, number];
    spread: number;
    sway: [number, number];
    swayDuration: [number, number];
    swayEasing: string;
    spinDuration: [number, number];
    opacity: [number, number];
    blur: [number, number];
    blurCurve: number;
    strokeBoost: number;
    fadeIn: number;
    fadeOut: number;
  };
  reduced: { duration: number; easing: string };
}

export const ANIMATION: AnimationConfig = {
  /** 全体の時間倍率（2 にすると全体が 2 倍遅くなる。開発時は ?slow=4 で上書き可） */
  timeScale: 1,

  /** 1. 中央の核がふわっと現れる */
  core: {
    duration: 450,
    easing: EASE.premium,
    /** 開始時の核の光の大きさ（1 = 最終サイズ） */
    fromScale: 0.4,
  },

  /** 2. 中心から外側へ線が描かれていく */
  grow: {
    /** 前のフェーズ（core）終了からの開始オフセット。負の値で重ねる */
    offset: -250,
    /** 成長全体（中心 → 最外周の枝先）の時間 */
    duration: 2200,
    /** 成長の前線の進み方 */
    curve: GROWTH_CURVES.easeOutQuad,
    /** 1 本の線を何分割して curve に沿わせるか（多いほど滑らか） */
    samples: 8,
    /** 描き始めの線端が点として見えないよう、最初の区間で不透明度を 0 → 1 にする */
    fadeInHead: true,
  },

  /** 2'. プレートの塗り（grow と並行して進む） */
  fill: {
    /** 輪郭を描き終えてから塗りが現れ始めるまで */
    delay: 60,
    /** 塗りがふわっと現れる時間 */
    duration: 600,
    easing: EASE.premium,
  },

  /**
   * 2''. 線のぼかし（soft-glow）を徐々に強める（grow と並行して進む）。
   * 伸びている間はぼかしを外して描画を軽くし、伸び終わり際からふわっとにじませる
   */
  glow: {
    /** grow の終了からの開始オフセット。負の値で伸び終わる前から始める */
    offset: -300,
    /** ぼかしが最大になるまでの時間 */
    duration: 1200,
    easing: EASE.sine,
  },

  /** 3. 完成時にほんの少しだけ光る */
  emphasis: {
    offset: 0,
    duration: 0,
    /** 最も光る瞬間の位置（0〜1、duration に対する比）。小さいほど「すっと光って、ゆっくり引く」 */
    peakAt: 0.35,
    /** 光り始めの easing（減速しながら最大へ） */
    riseEasing: EASE.out,
    /** 光が引いていく easing（ゆっくり動き出し、ゆっくり消える） */
    fallEasing: EASE.sine,
    /** 最大時の拡大率（1 = 変化なし） */
    peakScale: 1,
    /** 最大時の明るさ（1 = 変化なし） */
    peakBrightness: 1.25,
    /** 最大時の glow の広がり（px） */
    glowRadius: 8,
    glowColor: "rgba(200, 225, 255, 0.55)",
  },

  /** 4. 回転前の静止（emphasis と合わせて「完成 → 一瞬静止」になる） */
  hold: {
    offset: 0,
    duration: 0,
  },

  /** 5. ゆっくり回転して止まる */
  rotate: {
    offset: -2800,
    duration: 3000,
    easing: EASE.out,
    /**
     * 回転数（1 = 360°、0.5 = 180°）。
     * 結晶は 60° ごとに同じ形になるので、1/6 の倍数（1/6, 1/3, 0.5, 1 …）なら元と同じ見た目で止まる
     */
    turns: 1/3,
  },

  /** 6. 背景の雪：生成した結晶の小さなコピーが舞い落ちる（再生成まで降り続ける） */
  snowfall: {
    /** 回転終了からの開始オフセット。負の値で回転の終わり際から降り始める */
    offset: -2000,
    /** 画面 1280×800 あたりの数（小さい画面では自動で減らす） */
    count: 48,
    /** 中央（主役の結晶の周り）には降らせにくくする */
    center: {
      /** 空ける範囲：画面中央から左右それぞれ、画面幅に対する比（0.25 なら中央 50% の幅） */
      width: 0.4,
      /** 中央での降りやすさ（0 = 降らない / 1 = 他と同じ）。範囲の端に向かってなめらかに 1 に近づく */
      density: 0,
    },
    /** 大きさ（px）。小さいものほど遠くにあるように、暗く・ゆっくり・ぼかして描く */
    size: [2, 38],
    /** 画面の上から下まで落ちる時間。[近いもの, 遠いもの] */
    fallDuration: [16000, 68000],
    /** 降り始めのばらつき（落下時間に対する比）。大きいほどゆっくり増えていく */
    spread: 0.7,
    /** 左右の揺れ幅（中心からの片側、px） */
    sway: [8, 28],
    /** 左右に片道揺れる時間 */
    swayDuration: [2400, 6000],
    /** 揺れの easing。端でゆっくり折り返すよう ease-in-out 系にする */
    swayEasing: EASE.sine,
    /** 面内で 1 回転する時間（短いほどよく回る） */
    spinDuration: [6000, 14000],
    /** 不透明度。[遠いもの, 近いもの] */
    opacity: [0.08, 0.8],
    /** ぼかし（px）。[遠いもの, 近いもの]。小さい結晶ほど強くぼける */
    blur: [4, 0.8],
    /** 奥行きに対するぼかしの付き方（1 = 均等 / 大きいほど遠いものだけが強くぼける） */
    blurCurve: 2,
    /** 小さく描くと線が細くなりすぎるので、線幅を何倍にするか */
    strokeBoost: 1.5,
    fadeIn: 1500,
    /** 再生成時に、前の雪が消えるまでの時間 */
    fadeOut: 700,
  },

  /** prefers-reduced-motion: reduce のとき：成長・回転・拡大は行わずフェードのみ */
  reduced: {
    duration: 400,
    easing: EASE.premium,
  },
};

/** 各フェーズ単位で部分的に上書きできる設定 */
export type AnimationOverrides = {
  [K in keyof AnimationConfig]?: AnimationConfig[K] extends object ? Partial<AnimationConfig[K]> : AnimationConfig[K];
};

/** 設定を部分的に上書きする */
export function mergeAnimationConfig(overrides: AnimationOverrides = {}): AnimationConfig {
  const base = ANIMATION;
  return {
    timeScale: overrides.timeScale ?? base.timeScale,
    core: { ...base.core, ...overrides.core },
    grow: { ...base.grow, ...overrides.grow },
    fill: { ...base.fill, ...overrides.fill },
    glow: { ...base.glow, ...overrides.glow },
    emphasis: { ...base.emphasis, ...overrides.emphasis },
    hold: { ...base.hold, ...overrides.hold },
    rotate: { ...base.rotate, ...overrides.rotate },
    snowfall: { ...base.snowfall, ...overrides.snowfall },
    reduced: { ...base.reduced, ...overrides.reduced },
  };
}
