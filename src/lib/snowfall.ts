/**
 * 背景の雪：生成した結晶の小さなコピーを、雪のように舞い落とす。
 *
 * 描画済みの SVG を画像（data URL）にしてから <img> で並べるため、
 * 数十個を同時に動かしても重くならない。配置・速度は seed から決めるので、
 * 同じ入力からは同じ降り方になる。
 *
 * 遠近感のぼかし（遠いものほど強い）は CSS の filter ではなく、画像の SVG に feGaussianBlur として焼き込む。
 * CSS の filter だと回転・落下しているあいだ毎フレームぼかしを計算し直すが、焼き込んでおけば
 * 一度描いた画像を動かすだけで済む（ガウスぼかしは回転しても形が変わらないので、見た目は同じ）。
 */
import type { AnimationConfig } from "./animation-config";
import { createSeededRandom, type SeededRandom } from "./random";

export interface SnowfallRun {
  animations: Animation[];
  /** フェードアウトしてから要素を片付ける */
  dispose(): void;
}

/** 表示中の SVG の線と塗りを、CSS に依存しない SVG のマークアップ（viewBox 座標）に変換する */
function snapshotPaths(svg: SVGSVGElement, strokeBoost: number): string {
  const paths = Array.from(svg.querySelectorAll<SVGPathElement>("path.stroke, path.fill"));
  // getComputedStyle はスタイル計算を強制するので、見た目を決めるクラスごとに 1 回だけ読む
  const styles = new Map<string, CSSStyleDeclaration>();
  const styleOf = (path: SVGPathElement) => {
    const key = path.getAttribute("class") ?? "";
    let style = styles.get(key);
    if (!style) styles.set(key, (style = getComputedStyle(path)));
    return style;
  };
  return paths
    .map((path) => {
      const style = styleOf(path);
      const d = path.getAttribute("d") ?? "";
      if (path.classList.contains("fill")) {
        return `<path d="${d}" fill="${style.fill}" fill-opacity="${style.fillOpacity}"/>`;
      }
      const width = Number(path.getAttribute("stroke-width") ?? 1) * strokeBoost;
      return `<path d="${d}" fill="none" stroke="${style.stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("");
}

/** 結晶の viewBox（render.ts の VIEWBOX と同じ -100〜100 の正方形） */
const VIEW_MIN = -100;
const VIEW_SIZE = 200;

/**
 * 1 つの結晶の画像（data URL）を作る。
 * ぼかしの半径は画面上の px で指定し、表示サイズ size に合わせて viewBox の座標に換算して焼き込む。
 * にじみが画像の端で切れないよう、ぼかしの分だけ周りに余白（pad px）を足した画像にする。
 */
function flakeImage(paths: string, size: number, blur: number): { url: string; pad: number } {
  let svg: string;
  // CSS の blur() の半径は、ガウスぼかしの標準偏差と同じ。にじみはその 3 倍ほどまで見える
  const pad = blur > 0 ? Math.ceil(blur * 3) : 0;
  if (pad === 0) {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_MIN} ${VIEW_MIN} ${VIEW_SIZE} ${VIEW_SIZE}">${paths}</svg>`;
  } else {
    const unit = VIEW_SIZE / size;
    const min = VIEW_MIN - pad * unit;
    const span = VIEW_SIZE + pad * 2 * unit;
    const box = `${min} ${min} ${span} ${span}`;
    svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">` +
      `<filter id="b" filterUnits="userSpaceOnUse" x="${min}" y="${min}" width="${span}" height="${span}">` +
      `<feGaussianBlur stdDeviation="${(blur * unit).toFixed(3)}"/></filter>` +
      `<g filter="url(#b)">${paths}</g></svg>`;
  }
  // data URL にしておくと、後から解放する必要がない
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, pad };
}

function seedFrom(hex: string | undefined): SeededRandom {
  const bytes = new Uint8Array(32);
  // 結晶の生成とは別の乱数列にするため、ハッシュを逆順に使う
  (hex ?? "").match(/../g)?.reverse().forEach((byte, i) => (bytes[i] = parseInt(byte, 16)));
  return createSeededRandom(bytes);
}

const within = (rng: SeededRandom, [min, max]: readonly [number, number]) => rng.range(min, max);

/**
 * 横位置（0〜1）を選ぶ。中央ほど選ばれにくくして、主役の結晶の周りを空ける。
 * 候補を引いて、中央からの距離に応じた確率で採用する（棄却サンプリング）。
 */
function pickX(rng: SeededRandom, cfg: AnimationConfig["snowfall"]["center"]): number {
  for (let i = 0; i < 24; i++) {
    const x = rng.range(-0.02, 0.98);
    // 中央からの距離を 0（中央）〜1（空ける範囲の外）に正規化し、境目をなめらかにする
    const t = Math.min(1, Math.abs(x + 0.01 - 0.5) / cfg.width);
    const smooth = t * t * (3 - 2 * t);
    const accept = cfg.density + (1 - cfg.density) * smooth;
    if (rng.next() < accept) return x;
  }
  return rng.chance(0.5) ? rng.range(-0.02, 0.5 - cfg.width) : rng.range(0.5 + cfg.width, 0.98);
}

interface SnowfallOptions {
  startAt: number;
  ms: (v: number) => number;
  still: boolean;
}

/** 降り始めの何 ms 前に要素を用意するか */
const PREPARE_AHEAD = 200;

/**
 * 背景の雪を降らせる。
 * 降り始めるのは生成アニメーションの終わり際なので、要素づくり（SVG の書き出し・数十個の <img> と
 * そのアニメーションの登録）は降り始める直前まで遅らせ、Generate を押した直後の処理を軽くする。
 * 遅らせている間に dispose された場合は何も作らない。
 */
export function startSnowfall(
  layer: HTMLElement,
  svg: SVGSVGElement,
  cfg: AnimationConfig["snowfall"],
  options: SnowfallOptions,
): SnowfallRun {
  // reduced motion は動きがなく、完了の待ち合わせにも使われるのでその場で作る
  const wait = options.still ? 0 : options.startAt - PREPARE_AHEAD;
  if (wait <= 0) return buildSnowfall(layer, svg, cfg, options);

  const animations: Animation[] = [];
  let built: SnowfallRun | null = null;
  const requestedAt = performance.now();
  const timer = setTimeout(() => {
    // タイマーの遅れも含めて、実際に経った時間の分だけ開始時刻を前に詰める
    const elapsed = performance.now() - requestedAt;
    built = buildSnowfall(layer, svg, cfg, { ...options, startAt: Math.max(0, options.startAt - elapsed) });
    animations.push(...built.animations);
  }, wait);

  return {
    animations,
    dispose() {
      clearTimeout(timer);
      built?.dispose();
    },
  };
}

function buildSnowfall(
  layer: HTMLElement,
  svg: SVGSVGElement,
  cfg: AnimationConfig["snowfall"],
  options: SnowfallOptions,
): SnowfallRun {
  const paths = snapshotPaths(svg, cfg.strokeBoost);
  const rng = seedFrom(svg.dataset.seed);

  const group = document.createElement("div");
  group.className = "snowfall-run";
  layer.append(group);

  // 画面が小さいときは数を減らす
  const area = (window.innerWidth * window.innerHeight) / (1280 * 800);
  const count = Math.round(cfg.count * Math.min(1, Math.max(0.45, area)));

  const animations: Animation[] = [];
  for (let i = 0; i < count; i++) {
    // 奥行き：0 = 遠い（小さく・暗く・ゆっくり） / 1 = 近い
    const depth = rng.next();
    const size = cfg.size[0] + (cfg.size[1] - cfg.size[0]) * depth;

    // 動きごとに要素を分け、それぞれに合った easing で重ねる
    //   fall（縦に一定速度で落ちる） > sway（左右に滑らかに揺れる） > spin（面内で回る）
    const fall = document.createElement("div");
    const sway = document.createElement("div");
    const img = document.createElement("img");
    fall.className = "snowflake-bit";
    sway.className = "snowflake-sway";
    img.className = "snowflake-img";
    img.alt = "";
    fall.style.width = `${size}px`;
    fall.style.left = `${pickX(rng, cfg.center) * 100}%`;
    fall.style.opacity = String(cfg.opacity[0] + (cfg.opacity[1] - cfg.opacity[0]) * depth);
    // 遠いもの（depth が小さい）ほど強くぼかす（画像に焼き込む）
    const blur = cfg.blur[1] + (cfg.blur[0] - cfg.blur[1]) * (1 - depth) ** cfg.blurCurve;
    const image = flakeImage(paths, size, blur > 0.05 ? blur : 0);
    img.src = image.url;
    if (image.pad > 0) {
      // 余白の分だけ大きく描き、はみ出させて中心を合わせる（回転の中心も結晶の中心のまま）
      img.style.width = img.style.height = `${size + image.pad * 2}px`;
      img.style.margin = `${-image.pad}px`;
    }
    sway.append(img);
    fall.append(sway);
    group.append(fall);

    const startRotate = rng.range(0, 60);
    if (options.still) {
      // reduced motion：動かさず、画面内に静かに置くだけ
      fall.style.top = `${rng.range(0, 95)}%`;
      img.style.rotate = `${startRotate}deg`;
      continue;
    }

    const fallDuration = options.ms(cfg.fallDuration[1] - (cfg.fallDuration[1] - cfg.fallDuration[0]) * depth);
    animations.push(
      fall.animate([{ translate: "0 0" }, { translate: "0 115vh" }], {
        // 最初は上から少しずつ降り始めるよう、開始時刻をばらけさせる
        delay: options.startAt + rng.range(0, fallDuration * cfg.spread),
        duration: fallDuration,
        iterations: Infinity,
        easing: "linear",
        fill: "backwards",
      }),
    );

    // 横揺れ：端でゆっくり減速して折り返す（sine 系 ease-in-out を往復）
    const swayWidth = within(rng, cfg.sway);
    animations.push(
      sway.animate([{ translate: `${-swayWidth}px 0` }, { translate: `${swayWidth}px 0` }], {
        duration: options.ms(within(rng, cfg.swayDuration)),
        iterations: Infinity,
        direction: "alternate",
        easing: cfg.swayEasing,
        // 揺れ始めの位置をばらけさせる
        iterationStart: rng.range(0, 2),
      }),
    );

    // 面内の回転
    const spinSign = rng.chance(0.5) ? 1 : -1;
    animations.push(
      img.animate([{ rotate: `${startRotate}deg` }, { rotate: `${startRotate + 360 * spinSign}deg` }], {
        duration: options.ms(within(rng, cfg.spinDuration)),
        iterations: Infinity,
        easing: "linear",
      }),
    );
  }

  const fadeIn = group.animate([{ opacity: 0 }, { opacity: 1 }], {
    delay: options.startAt,
    duration: options.ms(cfg.fadeIn),
    easing: "ease-out",
    fill: "backwards",
  });
  animations.push(fadeIn);

  let disposed = false;
  return {
    animations,
    dispose() {
      if (disposed) return;
      disposed = true;
      // フェードイン途中でも今の濃さから消えるよう、止める前に現在値を読む
      const current = getComputedStyle(group).opacity;
      fadeIn.cancel();
      const fadeOut = group.animate([{ opacity: current }, { opacity: 0 }], {
        duration: options.ms(cfg.fadeOut),
        easing: "ease-in",
        fill: "forwards",
      });
      fadeOut.finished.finally(() => {
        animations.forEach((a) => a.cancel());
        group.remove();
      });
    },
  };
}
