import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, key);

export type Difficulty = "normal" | "hard";
export type Result     = "clear" | "gameover";

export async function logPlay(difficulty: Difficulty, result: Result) {
  await supabase.from("corgi_snack_game_play_logs").insert({ difficulty, result });
}

export async function fetchStats() {
  const { data } = await supabase
    .from("corgi_snack_game_play_logs")
    .select("difficulty, result");
  if (!data) return { total: 0, normalTotal: 0, normalClear: 0, hardTotal: 0, hardClear: 0 };
  return {
    total:       data.length,
    normalTotal: data.filter((r) => r.difficulty === "normal").length,
    normalClear: data.filter((r) => r.difficulty === "normal" && r.result === "clear").length,
    hardTotal:   data.filter((r) => r.difficulty === "hard").length,
    hardClear:   data.filter((r) => r.difficulty === "hard"   && r.result === "clear").length,
  };
}
