"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { logPlay, fetchStats } from "../lib/supabase";

// ===== 音声ファイル設定（差し替えはここだけ変更すればOK） =====
const SOUNDS = {
  bgmTitle: "/sounds/bgm-title.mp3",
  bgmGame:  "/sounds/bgm-game.mp3",
  success:  "/sounds/success.mp3",
  miss:     "/sounds/miss.mp3",
  clear:    "/sounds/clear.mp3",
} as const;

// ===== 型定義 =====
type Screen      = "title" | "game" | "result";
type ResultType  = "clear" | "gameover";
type CorgiAction =
  | "idle"
  | "runLeft" | "runRight"
  | "eatLeft" | "eatRight"
  | "scared";
type Difficulty  = "normal" | "hard";

// ===== 難易度設定 =====
const DIFFICULTY_CONFIG = {
  normal: { timeLimit: 30, watchMin: 1200, watchMax: 2000, awayMin: 800,  awayMax: 1700 },
  hard:   { timeLimit: 20, watchMin: 700,  watchMax: 1200, awayMin: 400,  awayMax: 800  },
} as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Stats = { total: number; normalTotal: number; normalClear: number; hardTotal: number; hardClear: number };

// ===== メインコンポーネント =====
export default function CorgiGame() {
  const [screen,        setScreen]        = useState<Screen>("title");
  const [ownerWatching, setOwnerWatching] = useState(false);
  const [leftSnacks,    setLeftSnacks]    = useState(3);
  const [rightSnacks,   setRightSnacks]   = useState(3);
  const [misses,        setMisses]        = useState(0);
  const [resultType,    setResultType]    = useState<ResultType>("clear");
  const [corgiAction,   setCorgiAction]   = useState<CorgiAction>("idle");
  const [isAnimating,   setIsAnimating]   = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [timeLeft,      setTimeLeft]      = useState(30);
  const [difficulty,    setDifficulty]    = useState<Difficulty>("normal");
  const [stats, setStats] = useState({ total: 0, normalTotal: 0, normalClear: 0, hardTotal: 0, hardClear: 0 });

  const bgmRef          = useRef<HTMLAudioElement | null>(null);
  const animIdRef       = useRef(0);
  const ownerWatchingRef = useRef(ownerWatching);

  // ----- 統計取得（マウント時） -----
  useEffect(() => {
    fetchStats().then(setStats);
  }, []);

  // ----- BGM管理 -----
  const playBgm = useCallback((src: string) => {
    bgmRef.current?.pause();
    try {
      const a = new Audio(src);
      a.loop   = true;
      a.volume = 0.3;
      bgmRef.current = a;
      a.play().catch(() => {});
    } catch {}
  }, []);

  const stopBgm = useCallback(() => {
    bgmRef.current?.pause();
    bgmRef.current = null;
  }, []);

  const playSound = useCallback((src: string, vol = 0.55) => {
    try {
      const a = new Audio(src);
      a.volume = vol;
      a.play().catch(() => {});
    } catch {}
  }, []);

  useEffect(() => {
    if (!hasInteracted) return;
    if (screen === "title")     playBgm(SOUNDS.bgmTitle);
    else if (screen === "game") playBgm(SOUNDS.bgmGame);
    else                        stopBgm();
  }, [screen, hasInteracted, playBgm, stopBgm]);

  useEffect(() => () => { bgmRef.current?.pause(); }, []);

  // 全画面で矢印キーのスクロールを防止
  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" ||
          e.key === "ArrowUp"   || e.key === "ArrowDown") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", block);
    return () => window.removeEventListener("keydown", block);
  }, []);

  // ownerWatching の最新値を ref に同期（アニメーション中のリアルタイム判定用）
  useEffect(() => { ownerWatchingRef.current = ownerWatching; }, [ownerWatching]);

  // ----- 飼い主タイマー -----
  useEffect(() => {
    if (screen !== "game") return;
    const cfg = DIFFICULTY_CONFIG[difficulty];
    let cancelled = false;
    let tid: ReturnType<typeof setTimeout>;
    const toggle = (next: boolean) => {
      if (cancelled) return;
      setOwnerWatching(next);
      const delay = next
        ? cfg.watchMin + Math.random() * cfg.watchMax
        : cfg.awayMin  + Math.random() * cfg.awayMax;
      tid = setTimeout(() => toggle(!next), delay);
    };
    tid = setTimeout(() => toggle(true), 1000 + Math.random() * 1000);
    return () => { cancelled = true; clearTimeout(tid); };
  }, [screen, difficulty]);

  // ----- カウントダウンタイマー -----
  useEffect(() => {
    if (screen !== "game") return;
    setTimeLeft(DIFFICULTY_CONFIG[difficulty].timeLimit);
    const tid = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(tid);
          stopBgm();
          logPlay(difficulty, "gameover").then(() => fetchStats().then(setStats));
          setResultType("gameover");
          setScreen("result");
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(tid);
  }, [screen, stopBgm, difficulty]);

  // ----- おやつを取るアクション -----
  const takeSnack = useCallback(
    async (side: "left" | "right") => {
      if (screen !== "game" || isAnimating) return;
      if (side === "left"  && leftSnacks  <= 0) return;
      if (side === "right" && rightSnacks <= 0) return;

      setIsAnimating(true);
      const id = animIdRef.current;
      const watching = ownerWatching;

      setCorgiAction(side === "left" ? "runLeft" : "runRight");
      await sleep(350);
      if (animIdRef.current !== id) return;

      // 激ムズ：走っている途中に見られていたらもミス
      const caughtDuringRun = difficulty === "hard" && ownerWatchingRef.current;

      if (!watching && !caughtDuringRun) {
        const newLeft  = side === "left"  ? leftSnacks  - 1 : leftSnacks;
        const newRight = side === "right" ? rightSnacks - 1 : rightSnacks;
        setLeftSnacks(newLeft);
        setRightSnacks(newRight);
        setCorgiAction(side === "left" ? "eatLeft" : "eatRight");
        playSound(SOUNDS.success);
        await sleep(550);
        if (animIdRef.current !== id) return;
        if (newLeft <= 0 && newRight <= 0) {
          playSound(SOUNDS.clear);
          stopBgm();
          logPlay(difficulty, "clear").then(() => fetchStats().then(setStats));
          setResultType("clear");
          setScreen("result");
          setCorgiAction("idle");
          setIsAnimating(false);
          return;
        }
      } else {
        const newMisses = misses + 1;
        setMisses(newMisses);
        setCorgiAction("scared");
        playSound(SOUNDS.miss);
        await sleep(600);
        if (animIdRef.current !== id) return;
        if (newMisses >= 3) {
          stopBgm();
          logPlay(difficulty, "gameover").then(() => fetchStats().then(setStats));
          setResultType("gameover");
          setScreen("result");
          setCorgiAction("idle");
          setIsAnimating(false);
          return;
        }
      }

      setCorgiAction("idle");
      setIsAnimating(false);
    },
    [screen, isAnimating, leftSnacks, rightSnacks, ownerWatching, misses, difficulty, playSound, stopBgm]
  );

  useEffect(() => {
    if (screen !== "game") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") e.preventDefault();
      if (e.key === "ArrowLeft")  takeSnack("left");
      if (e.key === "ArrowRight") takeSnack("right");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, takeSnack]);

  const startGame = (diff: Difficulty = difficulty) => {
    animIdRef.current += 1;
    setHasInteracted(true);
    setDifficulty(diff);
    setLeftSnacks(3);
    setRightSnacks(3);
    setMisses(0);
    setTimeLeft(DIFFICULTY_CONFIG[diff].timeLimit);
    setOwnerWatching(false);
    setCorgiAction("idle");
    setIsAnimating(false);
    setScreen("game");
  };

  if (screen === "title")
    return <TitleScreen onStart={startGame} stats={stats} onInteract={() => setHasInteracted(true)} />;
  if (screen === "result")
    return (
      <ResultScreen
        type={resultType}
        stats={stats}
        onRestart={() => startGame(difficulty)}
        onTitle={() => { setHasInteracted(true); setScreen("title"); }}
      />
    );
  return (
    <GameScreen
      ownerWatching={ownerWatching}
      leftSnacks={leftSnacks}
      rightSnacks={rightSnacks}
      misses={misses}
      corgiAction={corgiAction}
      isAnimating={isAnimating}
      timeLeft={timeLeft}
      onTakeSnack={takeSnack}
      onTitle={() => { animIdRef.current += 1; setScreen("title"); }}
    />
  );
}

// ===== タイトル画面 =====
function TitleScreen({ onStart, stats, onInteract }: { onStart: (diff: Difficulty) => void; stats: Stats; onInteract: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen p-4 font-mono"
      style={{ background: "#fdf6e3" }}
      onClick={onInteract}
    >
      <div className="w-full max-w-sm border-2 border-amber-600">
        <div className="h-2 bg-amber-400" />
        <div className="h-1 bg-amber-700 mb-5" />

        <div className="text-center space-y-5">
          {/* タイトル */}
          <div>
            <p className="text-amber-700 text-xs tracking-[0.3em] mb-1">── CORGI GAME ──</p>
            <h1
              className="text-4xl font-black text-amber-300 leading-tight tracking-wide"
              style={{ textShadow: "0 0 24px rgba(245,158,11,0.4), 3px 3px 0 #7c2d12" }}
            >
              コーギーの<br />
              <span className="text-amber-400 text-4xl">つまみぐい大作戦</span>
            </h1>
          </div>

          {/* コーギーをどーんと表示 */}
          <div className="flex justify-center py-2">
            <CorgiBody action="idle" size={240} />
          </div>


          {/* 難易度別スタートボタン */}
          <div className="flex flex-col gap-3 px-1">
            <button
              type="button"
              onClick={() => onStart("normal")}
              className="w-full py-4 font-black text-xl text-amber-950 tracking-widest cursor-pointer active:translate-y-1 transition-transform"
              style={{
                background: "linear-gradient(180deg, #fcd34d 0%, #f59e0b 50%, #d97706 100%)",
                boxShadow: "0 5px 0 #92400e",
              }}
            >
              ▶ 通常版 START
            </button>
            <button
              type="button"
              onClick={() => onStart("hard")}
              className="w-full py-4 font-black text-xl text-white tracking-widest cursor-pointer active:translate-y-1 transition-transform"
              style={{
                background: "linear-gradient(180deg, #f87171 0%, #dc2626 50%, #b91c1c 100%)",
                boxShadow: "0 5px 0 #7f1d1d",
              }}
            >
              🔥 激ムズ START
            </button>
          </div>
        </div>

        <div className="h-1 bg-amber-700 mt-5" />
        <div className="h-2 bg-amber-400" />
        <div className="text-center text-xs mt-2 space-y-0.5 text-amber-800">
          <p>累計プレイ：{stats.total}回</p>
          <p>通常版：{stats.normalTotal}回（クリア {stats.normalClear}回）　激ムズ：{stats.hardTotal}回（クリア {stats.hardClear}回）</p>
          <p className="mt-1">BGM：魔王魂　効果音：効果音ラボ</p>
        </div>
      </div>
    </div>
  );
}

// ===== ゲーム画面 =====
function GameScreen({
  ownerWatching, leftSnacks, rightSnacks, misses, corgiAction, isAnimating, timeLeft, onTakeSnack, onTitle,
}: {
  ownerWatching: boolean;
  leftSnacks: number;
  rightSnacks: number;
  misses: number;
  corgiAction: CorgiAction;
  isAnimating: boolean;
  timeLeft: number;
  onTakeSnack: (side: "left" | "right") => void;
  onTitle: () => void;
}) {
  const isScared = corgiAction === "scared";

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen p-3 font-mono transition-colors duration-300"
      style={{ background: "#fdf6e3" }}
    >
      <div className="w-full max-w-sm border-2 border-amber-600">
        {/* アクセントライン（状態で色変化） */}
        <div
          className="h-2 transition-colors duration-300"
          style={{ background: ownerWatching ? "#ef4444" : "#f59e0b" }}
        />

        {/* ヘッダー: 残機 + 状態 */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b transition-colors duration-300"
          style={{
            background: ownerWatching ? "#4d1515" : "#3d2010",
            borderColor: ownerWatching ? "#b91c1c" : "#7c4d0c",
          }}
        >
          <div className="flex gap-1">
            {Array.from({ length: 3 }, (_, i) => (
              <span
                key={i}
                className="text-sm transition-all duration-300"
                style={{ opacity: i < misses ? 0.25 : 1 }}
              >
                {i < misses ? "🖤" : "❤️"}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div
              className="text-xs font-bold px-3 py-1 rounded-sm transition-all duration-300"
              style={
                ownerWatching
                  ? { background: "#991b1b", color: "#fca5a5" }
                  : { background: "#14532d", color: "#86efac" }
              }
            >
              {ownerWatching ? "⚠ 見てる！" : "✓ チャンス！"}
            </div>
            <div
              className="text-sm font-black tabular-nums"
              style={{ color: timeLeft <= 10 ? "#f87171" : "#fcd34d" }}
            >
              ⏱{timeLeft}
            </div>
          </div>
        </div>

        {/* フィールド */}
        <div
          className="relative"
          style={{ background: "linear-gradient(180deg, #3d2010 0%, #4d2810 100%)" }}
        >
          {/* 壁の縦縞テクスチャ */}
          <div
            className="absolute inset-0 pointer-events-none opacity-5"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, #f59e0b 0px, transparent 1px, transparent 24px)",
            }}
          />

          {/* おやつ + 飼い主 */}
          <div className="relative flex items-end justify-between px-4 pt-5 pb-3">
            <SnackRow count={leftSnacks} side="left" />
            <OwnerCharacter watching={ownerWatching} />
            <SnackRow count={rightSnacks} side="right" />
          </div>

          {/* 床ライン */}
          <div className="mx-3 h-px" style={{ background: "#8c5530" }} />

          {/* コーギー走行エリア */}
          <div
            className="relative flex items-center justify-center overflow-hidden transition-colors duration-300"
            style={{
              height: 136,
              background: isScared ? "rgba(127,0,0,0.1)" : "transparent",
            }}
          >
            <CorgiCharacter action={corgiAction} />
          </div>
        </div>

        {/* 操作ボタン */}
        <div className="flex gap-2 p-3" style={{ background: "#2a1508" }}>
          <ActionButton
            label="← 取る"
            onClick={() => onTakeSnack("left")}
            disabled={leftSnacks <= 0 || isAnimating}
            empty={leftSnacks <= 0}
          />
          <ActionButton
            label="取る →"
            onClick={() => onTakeSnack("right")}
            disabled={rightSnacks <= 0 || isAnimating}
            empty={rightSnacks <= 0}
          />
        </div>

        <div
          className="h-2 transition-colors duration-300"
          style={{ background: ownerWatching ? "#ef4444" : "#f59e0b" }}
        />
        <p className="text-center text-xs mt-1" style={{ color: "#b45309" }}>
          キーボード ← → でも操作できます
        </p>
        <div className="px-3 pb-3 pt-1">
          <button
            type="button"
            onClick={onTitle}
            className="w-full py-3 font-bold text-sm cursor-pointer transition-colors hover:bg-amber-900"
            style={{ border: "2px solid #7c4d0c", color: "#d97706" }}
          >
            ↩ タイトルへ
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== アクションボタン =====
function ActionButton({
  label, onClick, disabled, empty,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  empty: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-1 py-4 font-black text-sm tracking-wider transition-all"
      style={
        empty
          ? { background: "#2a1508", color: "#7c4d0c", border: "2px solid #4d2810", cursor: "not-allowed", boxShadow: "none" }
          : disabled
          ? { background: "#4d2810", color: "#a16207", border: "none", cursor: "wait", boxShadow: "none" }
          : {
              background: "linear-gradient(180deg, #fcd34d 0%, #d97706 100%)",
              color: "#1a0a02",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 4px 0 #92400e",
            }
      }
    >
      {label}
    </button>
  );
}

// ===== 飼い主キャラクター =====
function OwnerCharacter({ watching }: { watching: boolean }) {
  return (
    <div className="flex flex-col items-center" style={{ minWidth: 72 }}>
      {/* ！マーク（見ているとき） */}
      <div
        className="font-black text-red-400"
        style={{
          height: 22,
          fontSize: 18,
          opacity: watching ? 1 : 0,
          transform: watching ? "scale(1) translateY(0)" : "scale(0) translateY(6px)",
          transition: "all 0.2s ease-out",
        }}
      >
        ！
      </div>

      {/* 飼い主画像（見てる：watching / 見てない：away） */}
      <div className="relative" style={{ width: 140, height: 140 }}>
        <img
          src="/images/owner-watching.png"
          alt="飼い主（見てる）"
          width={140}
          height={140}
          className="object-contain absolute inset-0 transition-opacity duration-400"
          style={{ opacity: watching ? 1 : 0 }}
        />
        <img
          src="/images/owner-away.png"
          alt="飼い主（見てない）"
          width={140}
          height={140}
          className="object-contain absolute inset-0 transition-opacity duration-400"
          style={{ opacity: watching ? 0 : 1 }}
        />
      </div>

      <div style={{ fontSize: 10, color: "#d97706", marginTop: 2 }}>飼い主</div>
    </div>
  );
}

// ===== コーギーキャラクター（移動ラッパー） =====
function CorgiCharacter({ action }: { action: CorgiAction }) {
  // 最後に走った方向を記憶（scared や idle でも向きを保持）
  const dirRef = useRef<"left" | "right">("right");
  if (action === "runLeft"  || action === "eatLeft")  dirRef.current = "left";
  if (action === "runRight" || action === "eatRight") dirRef.current = "right";

  const corgiX =
    action === "runLeft"  || action === "eatLeft"  ? -110 :
    action === "runRight" || action === "eatRight" ?  110 : 0;

  const animClass =
    action === "idle"                              ? "anim-corgi-bounce" :
    action === "runLeft"  || action === "runRight" ? "anim-corgi-run"    :
    action === "eatLeft"  || action === "eatRight" ? "anim-corgi-eat"    :
    action === "scared"                            ? "anim-corgi-scared" : "";

  const label =
    action === "eatLeft"  || action === "eatRight" ? "もぐもぐ！🦴" :
    action === "scared"                            ? "ビクッ！💦"    :
    action === "runLeft"  || action === "runRight" ? "ダッシュ！"    : "";

  return (
    <div style={{ transform: `translateX(${corgiX}px)`, transition: "transform 330ms ease-in-out" }}>
      <div className="flex flex-col items-center">
        <CorgiBody action={action} facingLeft={dirRef.current === "left"} animClass={animClass} />
        <div className="text-xs font-bold text-amber-300 -mt-1" style={{ height: 18 }}>
          {label}
        </div>
      </div>
    </div>
  );
}

// ===== コーギー画像（/images/ フォルダの画像を使用） =====
// 画像を差し替える場合は CORGI_IMG のパスを変更するだけでOK
const CORGI_IMG: Record<CorgiAction, string> = {
  idle:      "/images/corgi-idle.png",
  runLeft:   "/images/corgi-run.png",
  runRight:  "/images/corgi-run.png",
  eatLeft:   "/images/corgi-eat.png",
  eatRight:  "/images/corgi-eat.png",
  scared:    "/images/corgi-scared.png",
};

function CorgiBody({
  action = "idle",
  facingLeft = false,
  animClass = "",
  size = 180,
}: {
  action?: CorgiAction;
  facingLeft?: boolean;
  animClass?: string;
  size?: number;
}) {
  return (
    <div className={`select-none ${animClass}`}>
      <div style={{ transform: facingLeft ? "scaleX(-1)" : "scaleX(1)", transition: "transform 180ms ease" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={CORGI_IMG[action]}
          alt="corgi"
          width={size}
          height={size}
          className="object-contain"
        />
      </div>
    </div>
  );
}

// ===== おやつの列 =====
// 左側：右端（飼い主に近い側）から消える
// 右側：左端（飼い主に近い側）から消える
function SnackRow({ count, side }: { count: number; side: "left" | "right" }) {
  const isVisible = (i: number) =>
    side === "left" ? i < count : (2 - i) < count;

  return (
    <div className="text-center" style={{ minWidth: 72 }}>
      <div className="flex gap-1 justify-center mb-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="text-2xl"
            style={{
              display: "inline-block",
              opacity: isVisible(i) ? 1 : 0,
              transform: isVisible(i) ? "scale(1)" : "scale(0)",
              transition: "opacity 0.3s ease, transform 0.3s ease",
            }}
          >
            🦴
          </span>
        ))}
      </div>
      <div className="text-xs" style={{ color: "#d97706" }}>残り{count}個</div>
    </div>
  );
}

// ===== リザルト画面 =====
function ResultScreen({
  type, stats, onRestart, onTitle,
}: {
  type: ResultType;
  stats: Stats;
  onRestart: () => void;
  onTitle: () => void;
}) {
  const isClear = type === "clear";
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen p-4 font-mono"
      style={{ background: "#fdf6e3" }}
    >
      <div className="w-full max-w-sm text-center space-y-5 border-2 border-amber-600 p-6">
        <div className="h-2" style={{ background: isClear ? "#4ade80" : "#ef4444" }} />

        <div className="text-7xl anim-result-pop">{isClear ? "🎉" : "💔"}</div>

        <h2
          className="text-4xl font-black"
          style={{
            color: isClear ? "#86efac" : "#f87171",
            textShadow: isClear
              ? "0 0 24px rgba(74,222,128,0.5), 3px 3px 0 #14532d"
              : "0 0 24px rgba(248,113,113,0.5), 3px 3px 0 #7f1d1d",
          }}
        >
          {isClear ? "CLEAR！" : "GAME OVER"}
        </h2>

        {isClear && (
          <p className="text-sm leading-relaxed whitespace-pre-line text-black">
            コーギーはおやつを全部ゲット！{"\n"}うまくつまみ食いできたね 🐕
          </p>
        )}

        <div className="flex justify-center py-1">
          <div className="anim-corgi-bounce">
            <CorgiBody action="idle" />
          </div>
        </div>

        <div className="text-xs space-y-0.5 text-black">
          <p>累計プレイ：{stats.total}回</p>
          <p>通常版：{stats.normalTotal}回（クリア {stats.normalClear}回）　激ムズ：{stats.hardTotal}回（クリア {stats.hardClear}回）</p>
        </div>

        <div className="space-y-3 pt-1">
          <button
            onClick={onRestart}
            className="w-full py-4 font-black text-lg text-amber-950 tracking-widest cursor-pointer active:translate-y-1 transition-transform"
            style={{
              background: "linear-gradient(180deg, #fcd34d 0%, #d97706 100%)",
              boxShadow: "0 5px 0 #92400e",
            }}
          >
            ▶ もう一回！
          </button>
          <button
            onClick={onTitle}
            className="w-full py-3 font-bold text-sm cursor-pointer transition-colors hover:bg-amber-950"
            style={{ border: "2px solid #451a03", color: "#d97706" }}
          >
            ↩ タイトルへ
          </button>
        </div>

        <div className="h-2" style={{ background: isClear ? "#4ade80" : "#ef4444" }} />
      </div>
    </div>
  );
}
