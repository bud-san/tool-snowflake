/** 入力文字列 → SHA-256 → seeded random → パラメータ → 雪の結晶データ */
import { generateHash } from "./hash";
import { generateSnowflakeParameters } from "./params";
import { createSeededRandom } from "./random";
import { createSnowflake, type Snowflake } from "./symmetry";

export interface GeneratedSnowflake {
  hash: string;
  snowflake: Snowflake;
}

export async function generateSnowflake(input: string): Promise<GeneratedSnowflake> {
  const { hex, bytes } = await generateHash(input);
  const rng = createSeededRandom(bytes);
  const params = generateSnowflakeParameters(rng);
  return { hash: hex, snowflake: createSnowflake(params) };
}
