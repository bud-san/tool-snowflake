/**
 * 多数の入力から生成した雪の結晶を 1 枚の HTML に並べる（見た目確認用）。
 * bun scripts/contact-sheet.ts [出力パス]
 */
import { snowflakeMarkup, VIEWBOX } from "../src/lib/render";
import { generateSnowflake } from "../src/lib/snowflake";

const DEFS = `
<radialGradient id="core-glow"><stop offset="0" stop-color="#dbeeff" stop-opacity=".35"/><stop offset="1" stop-color="#dbeeff" stop-opacity="0"/></radialGradient>
<filter id="soft-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

const out = process.argv[2] ?? "contact-sheet.html";
const inputs = ["hello world", "", "雪の結晶", "snow", "❄️", "Astro", "abc", "123", "hash", "winter"];
for (let i = 0; i < 26; i++) inputs.push(`sample-${i}`);

const cells: string[] = [];
for (const input of inputs) {
  const { snowflake } = await generateSnowflake(input);
  cells.push(
    `<figure><svg viewBox="${VIEWBOX}"><defs>${DEFS}</defs><g>${snowflakeMarkup(snowflake)}</g></svg>` +
      `<figcaption>${input || "(empty)"} · ${snowflake.params.profile} · ${Object.values(snowflake.params.traits).join("/")}</figcaption></figure>`,
  );
}

await Bun.write(
  out,
  `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0b1320;color:#8aa0b8;font:11px system-ui;display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:8px}
figure{margin:0}svg{width:100%;display:block}
.stroke{fill:none;stroke:#eef6ff;stroke-linecap:round;stroke-linejoin:round}.fill{fill:#cfe4ff;fill-opacity:.2}
</style>${cells.join("")}`,
);
console.log(`wrote ${out}`);
