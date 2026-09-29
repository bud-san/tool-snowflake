/**
 * 背景のダイヤモンドダスト：空気中の細かな氷の粒が、中央の光に照らされて浮かび上がる。
 *
 * 粒そのものは発光させず、小さな点として画面全体に均等に置く。
 * 見え方（濃さ）は DIAMOND_DUST.light で決める。背景の中央の光と同じ位置・形の楕円で、
 * 光の中心ほど濃く・外ほど薄くする（土台・またたく粒とも、粒ごとの明るさとして適用）。
 *
 * Canvas に一度だけ描き、画面サイズが変わったときだけ描き直す（表示中の負荷はほぼない）。
 * 配置は固定の seed から決めるので、入力やリロードに関係なくいつも同じ模様になる。
 *
 * 漂い：粒を数枚の Canvas（層）に振り分け、層ごとに違う向き・速さでゆっくり上下させる。
 * 動かすのは層全体の transform だけなので描き直しは起きず、GPU の合成だけで済む。
 * 光の当たり方はマスクを使わず、粒ごとの明るさとして描くときに焼き込む
 * （マスクをかけた要素の中身が動くと、毎フレームマスクの合成がやり直されて重くなるため）。
 * 焼き込んだ明るさが位置とずれて見えないよう、動きは一方向に流し続けず、数十 px の範囲での往復にしている。
 *
 * またたき：静止した土台とは別に、少数の粒だけを DOM 要素として重ね、不透明度をゆっくり上げ下げする。
 * 不透明度の変化は描き直しを伴わない（GPU の合成だけで済む）ため、常に動いていても負荷はほぼ増えない。
 * 1 回光る間にも少しだけ上下に動き、消えている間に元の位置へ戻る。
 */
import { createSeededRandom, type SeededRandom } from "./random";

export const DIAMOND_DUST = {
  /** 画面 1280×800 あたりの粒の数（画面の広さに合わせて増減する） */
  count: 2800,
  /** 粒の半径（CSS px）。小さすぎると描画時に明るさがならされて見えなくなるため、下限は 0.5 程度にする */
  size: [0.6, 1.2],
  /** 粒ごとの不透明度 */
  opacity: [0.1, 0.75],
  /**
   * レイヤー全体の濃さ（一番後ろの背景なので薄め）。
   * 光の当たり方（中心ほど濃い）は light で調整する
   */
  layerOpacity: 1,
  /** 粒の色（ランダムに混ぜる） */
  colors: ["255, 255, 255", "214, 232, 255", "190, 216, 245"],
  /**
   * 光の当たり方。背景の光（global.css の body の radial-gradient）と同じ楕円にそろえる。
   * stops は [楕円の中心からの距離（0 = 中心, 1 = 楕円の縁）, 濃さ] の組。最後の値で、光の外側にどれだけ粒を残すかを決める
   */
  light: {
    /** 楕円の中心（画面に対する %） */
    center: [50, 58],
    /** 楕円の横・縦の半径（画面に対する %） */
    radius: [70, 55],
    stops: [
      [0, 1],
      [0.4, 0.65],
      [0.8, 0.2],
    ],
  },
  /**
   * 漂い：粒を層に振り分け、層ごとに上下にゆっくり往復させる（prefers-reduced-motion: reduce のときは止める）。
   * 層を増やすほど粒がばらばらに動いて見えるが、画面サイズの Canvas が 1 枚ずつ増える（GPU メモリを使う）
   */
  drift: {
    layers: [
      /** share: 振り分ける粒の割合 / distance: 中心から片側に動く距離（px） / duration: 片道の時間（ms） / up: 上へ動き出すか */
      { share: 0.45, distance: 8, duration: 26000, up: true },
      { share: 0.35, distance: 14, duration: 21000, up: false },
      { share: 0.2, distance: 22, duration: 17000, up: true },
    ],
    easing: "cubic-bezier(0.37, 0, 0.63, 1)",
  },
  /** またたく粒（静止した土台の上に重ねる） */
  twinkle: {
    /** 画面 1280×800 あたりの数（画面の広さに合わせて増減する） */
    count: 120,
    /** 粒の直径（CSS px） */
    size: [2, 3.2],
    /** 1 回のまたたき（ふっと光って消える）にかかる時間（ms） */
    duration: [2000, 4200],
    /** 最も光ったときの不透明度 */
    peakOpacity: [0.5, 1],
    /** またたいていない間の不透明度（0 = 完全に消える） */
    restOpacity: 0,
    /**
     * 光の中心からの距離に応じた出やすさ。light と同じ楕円で測り、
     * 中心 = 1 から外へ向かって下がり、光の外側では floor になる（明るさは light で別に下がる）
     */
    floor: 0.25,
    /** 1 回のまたたきの間に動く距離（px）。向きは粒ごとに上下どちらか */
    drift: [4, 12],
  },
} as const;

/** 画面サイズに依存しない、正規化した粒のデータ */
interface Particle {
  /** 位置（0〜1） */
  x: number;
  y: number;
  radius: number;
  alpha: number;
  color: string;
  /** 振り分けた層（DIAMOND_DUST.drift.layers の添字） */
  layer: number;
}

type Range = readonly [number, number];
const within = (rng: SeededRandom, [min, max]: Range) => rng.range(min, max);

function createParticles(count: number): Particle[] {
  // 入力に関係なく同じ模様になるよう、固定の seed を使う
  const rng = createSeededRandom(new Uint8Array(32).map((_, i) => (i * 37 + 11) & 0xff));
  // 層の振り分けは別の乱数列で決め、粒の配置そのものは変えない
  const layerRng = createSeededRandom(new Uint8Array(32).map((_, i) => (i * 71 + 5) & 0xff));
  const cfg = DIAMOND_DUST;
  const layerWeights = cfg.drift.layers.map((layer, i) => [i, layer.share] as const);
  return Array.from({ length: count }, () => ({
    x: rng.next(),
    y: rng.next(),
    radius: within(rng, cfg.size),
    alpha: within(rng, cfg.opacity),
    color: cfg.colors[rng.int(0, cfg.colors.length - 1)],
    layer: layerRng.weighted(layerWeights),
  }));
}

/**
 * 1 つの層を描く。Canvas は動く距離の分だけ上下にはみ出して置いているので（margin）、
 * はみ出した部分にも粒を置き、光の当たり方は画面上の位置で決める
 */
function draw(canvas: HTMLCanvasElement, particles: Particle[], margin: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const viewHeight = height - margin * 2;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  for (const p of particles) {
    const y = p.y * height;
    const light = lightAt(p.x, (y - margin) / viewHeight);
    ctx.fillStyle = `rgba(${p.color}, ${p.alpha * light})`;
    ctx.beginPath();
    ctx.arc(p.x * width, y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 光の楕円の中心からの距離（0 = 中心, 1 = 楕円の縁）。x, y は画面に対する 0〜1 */
function lightDistance(x: number, y: number): number {
  const { center, radius } = DIAMOND_DUST.light;
  return Math.hypot((x - center[0] / 100) / (radius[0] / 100), (y - center[1] / 100) / (radius[1] / 100));
}

/** その位置での光の当たり具合（stops を直線でつないだ値。CSS の radial-gradient と同じ補間） */
function lightAt(x: number, y: number): number {
  const stops = DIAMOND_DUST.light.stops;
  const d = lightDistance(x, y);
  if (d <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [d0, v0] = stops[i - 1];
    const [d1, v1] = stops[i];
    if (d <= d1) return v0 + ((v1 - v0) * (d - d0)) / (d1 - d0);
  }
  return stops[stops.length - 1][1];
}

/** 光の中心からの距離に応じて、またたく粒を置く位置（0〜1）を選ぶ */
function pickTwinklePosition(rng: SeededRandom): { x: number; y: number } {
  const { floor } = DIAMOND_DUST.twinkle;
  for (let i = 0; i < 32; i++) {
    const x = rng.next();
    const y = rng.next();
    const chance = Math.max(floor, 1 - lightDistance(x, y) / 0.8);
    if (rng.next() < chance) return { x, y };
  }
  return { x: rng.next(), y: rng.next() };
}

/** またたく粒を置く。動きを減らす設定のときは置かない */
export function mountTwinkle(layer: HTMLElement): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cfg = DIAMOND_DUST.twinkle;
  // 土台とは別の、固定の seed
  const rng = createSeededRandom(new Uint8Array(32).map((_, i) => (i * 53 + 29) & 0xff));
  const area = (window.innerWidth * window.innerHeight) / (1280 * 800);
  const count = Math.round(cfg.count * Math.min(1.6, Math.max(0.4, area)));

  for (let i = 0; i < count; i++) {
    const { x, y } = pickTwinklePosition(rng);
    const size = within(rng, cfg.size);
    const dot = document.createElement("span");
    dot.className = "twinkle-dot";
    dot.style.left = `${x * 100}%`;
    dot.style.top = `${y * 100}%`;
    dot.style.width = dot.style.height = `${size}px`;
    dot.style.background = `rgb(${DIAMOND_DUST.colors[rng.int(0, DIAMOND_DUST.colors.length - 1)]})`;
    layer.append(dot);

    // 土台と同じ光の当たり方で、端ほど薄くする（マスクを使わず、粒ごとの明るさとして先に計算しておく）
    const peak = within(rng, cfg.peakOpacity) * lightAt(x, y);
    const timing = {
      duration: within(rng, cfg.duration),
      iterations: Infinity,
      // またたくタイミングを粒ごとにばらけさせる
      iterationStart: rng.next(),
      fill: "both",
    } as const;
    dot.animate(
      [
        { opacity: cfg.restOpacity, scale: 0.6, easing: "cubic-bezier(0.37, 0, 0.63, 1)" },
        { opacity: peak, scale: 1, offset: 0.5, easing: "cubic-bezier(0.37, 0, 0.63, 1)" },
        { opacity: cfg.restOpacity, scale: 0.6 },
      ],
      timing,
    );
    // またたきと同じ周期で少しだけ動く。消えている瞬間に元の位置へ戻るので、戻りは見えない
    const drift = within(rng, cfg.drift) * (rng.chance(0.5) ? -1 : 1);
    dot.animate([{ transform: `translateY(${-drift / 2}px)` }, { transform: `translateY(${drift / 2}px)` }], timing);
  }
}

/** ダイヤモンドダストの層を container の中に作って描き、ゆっくり漂わせる。サイズ変更にも追従させる */
export function mountDiamondDust(container: HTMLElement): void {
  const { drift } = DIAMOND_DUST;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // 大きな画面でも足りるよう、上限分の粒を先に作っておく
  const particles = createParticles(Math.round(DIAMOND_DUST.count * 1.6));
  container.style.opacity = String(DIAMOND_DUST.layerOpacity);

  const layers = drift.layers.map((layer) => {
    const margin = reduced ? 0 : layer.distance;
    const canvas = document.createElement("canvas");
    canvas.className = "diamond-dust-layer";
    // 動いても端が切れないよう、動く距離の分だけ上下にはみ出させる
    canvas.style.top = `${-margin}px`;
    canvas.style.height = `calc(100% + ${margin * 2}px)`;
    container.append(canvas);
    if (!reduced) {
      const from = layer.up ? margin : -margin;
      canvas.animate([{ transform: `translateY(${from}px)` }, { transform: `translateY(${-from}px)` }], {
        duration: layer.duration,
        easing: drift.easing,
        direction: "alternate",
        iterations: Infinity,
        // 往復の真ん中（元の位置）から動き出す
        iterationStart: 0.5,
        fill: "both",
      });
    }
    return { canvas, margin };
  });

  let frame = 0;
  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // 画面が小さいときは粒を減らす（配置は同じ並びの先頭から使う）
      const area = (container.clientWidth * container.clientHeight) / (1280 * 800);
      const visible = particles.slice(0, Math.round(DIAMOND_DUST.count * Math.min(1.6, Math.max(0.35, area))));
      layers.forEach(({ canvas, margin }, i) =>
        draw(
          canvas,
          visible.filter((p) => p.layer === i),
          margin,
        ),
      );
    });
  };
  new ResizeObserver(redraw).observe(container);
  redraw();
}
