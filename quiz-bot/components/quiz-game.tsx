"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Mascot } from "@/components/mascot"
import { BackgroundGif, type GifState } from "@/components/background-gif"
import { ResultScreen } from "@/components/result-screen"
import { useAdventureRide, type RideState } from "@/components/adventure-stage"
import { dummyBlankQuestions } from "@/lib/dummy-blank"
import { playCorrect, playWrong, playDecide, startBgmGame, startBgmMenu, stopAllBgm, setMuted, preloadAll } from "@/lib/sound-manager"
import { ParrotRain } from "@/components/parrot-rain"
import { ImageScreen } from "@/components/image-screen"

// --- Types ---

interface SeriesPoint { x: string; y: number }
interface ChoiceItem { label: string; series: number[] }

interface Question {
  ID: number; DECK: string; QTYPE: string; QUESTION_TEXT: string
  ITEM_A: string | null; ITEM_B: string | null; METRIC: string
  VALUE_A: number; VALUE_B: number
  SERIES: SeriesPoint[] | null; MASK_FROM: number | null; MASK_TO: number | null
  CHOICES: ChoiceItem[] | null; CORRECT: number; EXPLANATION: string; SQL_TEXT: string
}

interface AnswerRecord { deck: string; correct: boolean }

type Phase = "splash" | "mode" | "count" | "start" | "loading" | "question" | "moving" | "result" | "finished"

const MOVE_MS = 1650

const DECKS = [
  { value: "all", label: "すべて", emoji: "🎯" },
  { value: "category", label: "カテゴリ", emoji: "🛍" },
  { value: "state", label: "都道府県", emoji: "🗾" },
  { value: "month", label: "時期", emoji: "📅" },
  { value: "segment", label: "顧客セグメント", emoji: "👑" },
  { value: "weather", label: "天気", emoji: "🌧" },
  { value: "customer", label: "顧客属性", emoji: "👥" },
]

const MODES = [
  { value: "mix", label: "ミックス" },
  { value: "highlow", label: "High & Low" },
  { value: "blank", label: "虫食い" },
]

const N_OPTIONS = [5, 10, 20]

const DECK_COLORS: Record<string, string> = {
  all: "from-blue-500 to-blue-700",
  category: "from-pink-500 to-rose-600",
  state: "from-green-500 to-emerald-700",
  month: "from-amber-500 to-orange-600",
  segment: "from-purple-500 to-violet-700",
  weather: "from-sky-400 to-cyan-600",
  customer: "from-indigo-500 to-blue-700",
}

// --- Helpers ---

function formatNumber(n: number, metric: string): string {
  if (metric.endsWith("_share") || metric.endsWith("_rate")) return `${n.toLocaleString()}%`
  if (metric === "aov" || metric === "spend_per_customer") return `${Math.round(n).toLocaleString()}円`
  if (metric === "orders_per_customer") return `${n.toLocaleString()}回`
  if (metric === "orders") return `${Math.round(n).toLocaleString()}件`
  if (metric === "sales") {
    if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}億円`
    if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString()}万円`
    return `${Math.round(n).toLocaleString()}円`
  }
  return n.toLocaleString()
}

// --- SVG ---

function MiniLineChart({ points, width = 120, height = 60, strokeColor = "currentColor", strokeWidth = 2 }: {
  points: number[]; width?: number; height?: number; strokeColor?: string; strokeWidth?: number
}) {
  if (!points.length) return null
  const min = Math.min(...points); const max = Math.max(...points); const range = max - min || 1
  const coords = points.map((v, i) => {
    const x = (i / Math.max(points.length - 1, 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x},${y}`
  })
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <polyline points={coords.join(" ")} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function BlankChart({ series, maskFrom, maskTo }: { series: SeriesPoint[]; maskFrom: number; maskTo: number }) {
  const W = 600, H = 200, PAD = 20
  const chartW = W - PAD * 2, chartH = H - PAD * 2
  const vals = series.map((p) => p.y)
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
  const toX = (i: number) => PAD + (i / Math.max(series.length - 1, 1)) * chartW
  const toY = (v: number) => PAD + chartH - ((v - min) / range) * chartH

  const beforePts: string[] = []
  const afterPts: string[] = []
  for (let i = 0; i < series.length; i++) {
    const coord = `${toX(i)},${toY(series[i].y)}`
    if (i <= maskFrom - 1) beforePts.push(coord)
    if (i >= maskTo + 1) afterPts.push(coord)
  }

  const bandX1 = toX(Math.max(maskFrom - 1, 0))
  const bandX2 = toX(Math.min(maskTo + 1, series.length - 1))
  const bandMidX = (bandX1 + bandX2) / 2
  const bandMidY = PAD + chartH / 2

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block mx-auto max-w-full">
      <rect x={PAD} y={PAD} width={chartW} height={chartH} fill="none" stroke="var(--border)" strokeWidth={0.5} />
      {beforePts.length > 1 && <polyline points={beforePts.join(" ")} fill="none" stroke="var(--foreground)" strokeWidth={2} strokeLinejoin="round" />}
      {afterPts.length > 1 && <polyline points={afterPts.join(" ")} fill="none" stroke="var(--foreground)" strokeWidth={2} strokeLinejoin="round" />}
      <rect x={bandX1} y={PAD} width={bandX2 - bandX1} height={chartH} fill="var(--muted)" opacity={0.6} />
      <rect x={bandMidX - 24} y={bandMidY - 20} width={48} height={40} rx={4} fill="white" stroke="red" strokeWidth={2} />
      <text x={bandMidX} y={bandMidY + 8} textAnchor="middle" fontSize={24} fontWeight="bold" fill="red">?</text>
      {[0, series.length - 1].map((idx) => (
        <text key={idx} x={toX(idx)} y={H - 2} textAnchor="middle" fontSize={8} fill="var(--muted-foreground)">{series[idx]?.x ?? ""}</text>
      ))}
    </svg>
  )
}

function FullChart({ series }: { series: SeriesPoint[] }) {
  const W = 600, H = 200, PAD = 20
  const chartW = W - PAD * 2, chartH = H - PAD * 2
  const vals = series.map((p) => p.y)
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
  const pts = series.map((p, i) => {
    const x = PAD + (i / Math.max(series.length - 1, 1)) * chartW
    const y = PAD + chartH - ((p.y - min) / range) * chartH
    return `${x},${y}`
  })
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block mx-auto max-w-full">
      <rect x={PAD} y={PAD} width={chartW} height={chartH} fill="none" stroke="var(--border)" strokeWidth={0.5} />
      <polyline points={pts.join(" ")} fill="none" stroke="var(--foreground)" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  )
}

// --- Splash Screen ---

function SplashScreen({ onStart }: { onStart: () => void }) {
  const [imgOk, setImgOk] = useState(true)
  useEffect(() => {
    const handler = () => onStart()
    window.addEventListener("keydown", handler)
    window.addEventListener("pointerdown", handler)
    return () => {
      window.removeEventListener("keydown", handler)
      window.removeEventListener("pointerdown", handler)
    }
  }, [onStart])

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center cursor-pointer">
      {imgOk && (
        <img
          src="/bg/home.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          onError={() => setImgOk(false)}
        />
      )}
      <p className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white text-sm tracking-widest pointer-events-none" style={{ animation: "splash-blink 1s ease-in-out infinite" }}>
        PRESS ANY BUTTON
      </p>
    </div>
  )
}

// --- Component ---

export function QuizGame() {
  const { setRideState, setCartVariant } = useAdventureRide()
  const [playerName, setPlayerName] = useState("guest")
  const [mode, setMode] = useState("mix")
  const [nQuestions, setNQuestions] = useState(10)
  const [deck, setDeck] = useState("all")
  const [idsParam, setIdsParam] = useState("")
  const [questions, setQuestions] = useState<Question[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>("splash")
  const [chosen, setChosen] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [total, setTotal] = useState(0)
  const [showSql, setShowSql] = useState(false)
  const [showDef, setShowDef] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null)
  const [gifState, setGifState] = useState<GifState>("wait")
  const [muted, setMutedState] = useState(false)
  const [answers, setAnswers] = useState<AnswerRecord[]>([])
  const [rainbow, setRainbow] = useState(false)
  const [rainbowType, setRainbowType] = useState<"parrot" | "tanaka" | null>(null)
  const [dobon, setDobon] = useState(false)
  const [dobonAt, setDobonAt] = useState<number | null>(null)
  const [parrotOverride, setParrotOverride] = useState<string | undefined>(undefined)
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initRef = useRef(false)

  function normalizeForRainbow(name: string): string {
    return name.trim().toLowerCase().replace(/[\s\-\u3000_ー]/g, "")
  }

  const PARROT_NAMES = ["partyparrot", "パーティパロット", "ぱーてぃぱろっと"]
  const TANAKA_NAMES = ["rainbowtanaka", "レインボ田中", "レインボたなか", "れいんぼたなか"]

  function checkRainbow(name: string) {
    const norm = normalizeForRainbow(name)
    if (PARROT_NAMES.some((n) => normalizeForRainbow(n) === norm)) { setRainbow(true); setRainbowType("parrot"); setCartVariant("parrot"); return true }
    if (TANAKA_NAMES.some((n) => normalizeForRainbow(n) === norm)) { setRainbow(true); setRainbowType("tanaka"); setCartVariant("parrot"); return true }
    setRainbow(false); setRainbowType(null); setCartVariant("normal"); return false
  }

  // URL param init
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    const sp = new URLSearchParams(window.location.search)
    if (sp.get("player")) { setPlayerName(sp.get("player")!); checkRainbow(sp.get("player")!) }
    if (sp.get("mode")) setMode(sp.get("mode")!)
    if (sp.get("deck")) setDeck(sp.get("deck")!)
    if (sp.get("n")) setNQuestions(parseInt(sp.get("n")!, 10) || 10)
    if (sp.get("ids")) setIdsParam(sp.get("ids")!)
    if (sp.get("dobon") === "1") setDobon(true)
    if (sp.get("ids") || sp.get("autostart") === "1") {
      setPhase("start")
      setTimeout(() => { document.getElementById("autostart-trigger")?.click() }, 100)
    }
  }, [])

  const fetchQuestions = useCallback(async (selectedDeck: string, selectedMode: string, ids?: string, n?: number) => {
    setPhase("loading")
    setError(null)
    try {
      let url = `/api/quiz?deck=${selectedDeck}&mode=${selectedMode}&n=${n ?? nQuestions}`
      if (ids) url += `&ids=${ids}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      let qs: Question[] = data.questions ?? []
      const blankQs = qs.filter((q) => q.QTYPE === "blank")
      if ((selectedMode === "blank" || selectedMode === "mix") && blankQs.length === 0) {
        qs = [...qs, ...(dummyBlankQuestions as unknown as Question[])]
      }
      if (!qs.length) throw new Error("問題がありません")
      setQuestions(qs)
      setCurrentIdx(0)
      setScore(0)
      setStreak(0)
      setTotal(0)
      setLastCorrect(null)
      setAnswers([])
      setGifState("wait")
      setPhase("question")
      setRideState("running")
      setDobonAt(null)
      setParrotOverride(undefined)
      startBgmGame()
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込み失敗")
      setPhase("start")
      setRideState("parked")
    }
  }, [nQuestions])

  const handleStart = (selectedDeck: string) => {
    setDeck(selectedDeck)
    checkRainbow(playerName)
    preloadAll()
    fetchQuestions(selectedDeck, mode, idsParam || undefined, nQuestions)
  }

  const handleExit = () => {
    if (moveTimerRef.current) clearTimeout(moveTimerRef.current)
    setQuestions([])
    setScore(0)
    setStreak(0)
    setTotal(0)
    setPhase("start")
    setAnswers([])
    setRideState("parked")
    stopAllBgm()
    startBgmMenu()
  }

  const q = questions[currentIdx] ?? null

  const handleAnswer = async (choice: number) => {
    if (!q) return
    setChosen(choice)
    const correct = choice === q.CORRECT

    // Ride direction
    const direction = q.QTYPE === "blank" ? (choice % 2 === 0 ? "left" : "right") : (choice === 0 ? "left" : "right")
    setRideState(`${direction}-${correct ? "safe" : "lava"}` as RideState)
    playDecide()

    // POST answer immediately
    fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: q.ID, chosen: choice, player: playerName || "guest", is_correct: correct }),
    }).catch(() => {})

    // Determine direction
    const isLeft = q.QTYPE === "blank" ? (choice === 0 || choice === 2) : choice === 0
    setGifState(isLeft ? "move_l" : "move_r")
    setPhase("moving")

    moveTimerRef.current = setTimeout(() => {
      setLastCorrect(correct)
      if (correct) {
        setScore((s) => s + 1)
        setStreak((prev) => prev + 1)
        playCorrect()
        if (rainbow) setParrotOverride("partyparrot")
      } else {
        setStreak(0)
        playWrong()
        if (rainbow) setParrotOverride("sadparrot")
        if (dobon) setDobonAt(currentIdx + 1)
      }
      setTotal((t) => t + 1)
      setAnswers((a) => [...a, { deck: DECKS.find((d) => d.value === q.DECK)?.label ?? q.DECK, correct }])
      setGifState(correct ? "answer_true" : "answer_false")
      setPhase("result")
      setShowSql(false)
      setShowDef(false)
    }, MOVE_MS)
  }

  const handleNext = () => {
    const isLast = currentIdx + 1 >= questions.length
    const dobonEnd = dobon && dobonAt != null
    if (isLast || dobonEnd) {
      setPhase("finished")
      setRideState("parked")
      stopAllBgm()
      startBgmMenu()
    } else {
      setCurrentIdx((i) => i + 1)
      setChosen(null)
      setPhase("question")
      setShowSql(false)
      setShowDef(false)
      setGifState("wait")
      setRideState("running")
      setParrotOverride(undefined)
    }
  }

  const handleMuteToggle = () => {
    const next = !muted
    setMutedState(next)
    setMuted(next)
  }

  // --- Splash ---
  if (phase === "splash") {
    return <SplashScreen onStart={() => { startBgmMenu(); setPhase("start") }} />
  }

  // --- Mode selection ---
  if (phase === "mode") {
    return (
      <ImageScreen
        src="/bg/mode.jpg"
        hotspots={[
          { left: "27%", top: "38%", width: "22%", height: "45%", onClick: () => { setMode("blank"); setPhase("count") }, label: "虫食いクイズ" },
          { left: "51%", top: "38%", width: "22%", height: "45%", onClick: () => { setMode("mix"); setPhase("count") }, label: "4択クイズ" },
        ]}
      />
    )
  }

  // --- Count selection ---
  if (phase === "count") {
    return (
      <ImageScreen
        src="/bg/count.jpg"
        hotspots={[
          { left: "26%", top: "38%", width: "15%", height: "33%", onClick: () => setNQuestions(5), label: "5問", highlight: nQuestions === 5 },
          { left: "42%", top: "38%", width: "15%", height: "33%", onClick: () => setNQuestions(10), label: "10問", highlight: nQuestions === 10 },
          { left: "59%", top: "38%", width: "15%", height: "33%", onClick: () => setNQuestions(20), label: "20問", highlight: nQuestions === 20 },
          { left: "32%", top: "77%", width: "13%", height: "8%", onClick: () => setPhase("mode"), label: "戻る" },
          { left: "50%", top: "77%", width: "17%", height: "8%", onClick: () => setPhase("start"), label: "次へ" },
        ]}
      />
    )
  }

  // --- Deck Screen (start) ---
  if (phase === "start") {
    return (
      <div className={`relative min-h-[60vh] ${rainbow ? "rainbow-mode" : ""}`}>
        {rainbow && <div className="rainbow-bg-overlay" />}
        {rainbow && rainbowType === "parrot" && <ParrotRain count={40} />}
        {rainbow && rainbowType === "tanaka" && <ParrotRain count={10} />}
        {rainbow && rainbowType === "tanaka" && <div className="rainbow-tanaka-badge">👑 RAINBOW TANAKA</div>}
        {/* Background image with overlay */}
        <div className="fixed inset-0 -z-10">
          <img src="/bg/category.jpg" alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        </div>
        <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-lg adventure-card">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">TROCCO QUIZ ADVENTURE</CardTitle>
            <p className="text-muted-foreground text-sm mt-1">β-LEAGUE ― 楽天クイズ 知ってるつもり？</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && <p className="text-destructive text-sm text-center">{error}</p>}

            <div>
              <label className="text-sm font-medium block mb-1">回答者名</label>
              <div className="flex gap-2">
                <input type="text" className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="guest" value={playerName} onChange={(e) => setPlayerName(e.target.value)} onBlur={() => checkRainbow(playerName)} onKeyDown={(e) => { if (e.key === "Enter") checkRainbow(playerName) }} />
                <Button size="sm" variant="outline" onClick={() => checkRainbow(playerName)}>確定</Button>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium block mb-1">モード</label>
                <div className="flex gap-1">
                  {MODES.map((m) => (
                    <Button key={m.value} variant={mode === m.value ? "default" : "outline"} size="sm" onClick={() => setMode(m.value)}>{m.label}</Button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">問題数</label>
                <div className="flex gap-1">
                  {N_OPTIONS.map((n) => (
                    <Button key={n} variant={nQuestions === n ? "default" : "outline"} size="sm" onClick={() => setNQuestions(n)}>{n}</Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Dobon toggle */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={dobon} onChange={(e) => setDobon(e.target.checked)} className="rounded" />
              <span>ドボン（1 回間違えたら終了）</span>
            </label>

            <p className="text-sm font-medium text-center mt-2">デッキを選んでスタート</p>
            <div className="grid grid-cols-2 gap-3">
              {DECKS.map((d) => (
                <button
                  key={d.value}
                  id={d.value === (idsParam ? deck : "all") ? "autostart-trigger" : undefined}
                  className={`rounded-xl p-4 text-white text-left transition-all hover:scale-105 ${d.value === "all" ? "col-span-2" : ""} bg-gradient-to-br ${DECK_COLORS[d.value] ?? "from-gray-500 to-gray-700"}`}
                  onClick={() => handleStart(d.value)}
                >
                  <span className="text-2xl block mb-1">{d.emoji}</span>
                  <span className="text-sm font-semibold">{d.label}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        </div>
      </div>
    )
  }

  if (phase === "loading") {
    return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-muted-foreground">読み込み中...</p></div>
  }

  // --- Finished ---
  if (phase === "finished") {
    return <ResultScreen score={score} total={total} answers={answers} rainbow={rainbow} dobonAt={dobonAt} onRetry={() => { preloadAll(); fetchQuestions(deck, mode, idsParam || undefined, nQuestions) }} onTop={() => { setQuestions([]); setPhase("start"); setRideState("parked") }} />
  }

  if (!q) return null

  const isCorrect = chosen === q.CORRECT
  const isBlank = q.QTYPE === "blank"
  const showGif = phase === "question" || phase === "moving" || phase === "result"

  const dobonEnd = dobon && dobonAt != null && !isCorrect

  return (
    <div className={`w-full max-w-2xl mx-auto space-y-4 relative ${rainbow ? "rainbow-mode" : ""}`}>
      {/* Rainbow overlay */}
      {rainbow && <div className="rainbow-bg-overlay" />}
      {rainbow && rainbowType === "parrot" && <ParrotRain count={40} override={parrotOverride} />}
      {rainbow && rainbowType === "tanaka" && <ParrotRain count={10} override={parrotOverride} />}
      {rainbow && rainbowType === "tanaka" && <div className="rainbow-tanaka-badge">👑 RAINBOW TANAKA</div>}

      {/* Background GIF */}
      {showGif && <BackgroundGif state={gifState} questionIdx={currentIdx} />}

      {/* Mascot */}
      <div className="fixed bottom-4 left-4 z-50"><Mascot streak={streak} isCorrect={lastCorrect} /></div>

      {/* Top bar */}
      <div className="flex items-center justify-between px-1 adventure-scorebar py-2 px-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold">Q {currentIdx + 1} / {questions.length}</span>
          {/* Progress dots */}
          <div className="flex gap-1">
            {questions.map((_, i) => (
              <span key={i} className={`w-2 h-2 rounded-full ${i < total ? (answers[i]?.correct ? "bg-green-500" : "bg-red-500") : i === currentIdx ? "bg-primary" : "bg-muted"}`} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">SCORE {score * 100} pt</span>
          <button onClick={handleMuteToggle} className="text-lg" title={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🔊"}</button>
          <Button variant="ghost" size="sm" className="text-xs text-destructive" onClick={handleExit}>EXIT</Button>
        </div>
      </div>

      {streak >= 2 && <div className="text-center text-orange-500 font-bold text-sm animate-bounce">{streak} 連勝!</div>}

      {/* Question Card */}
      <Card className={`adventure-card ${showGif ? "bg-background/85 backdrop-blur" : ""}`}>
        <CardHeader>
          <Badge variant="outline" className="text-xs w-fit mb-1">{DECKS.find((d) => d.value === q.DECK)?.label ?? q.DECK}</Badge>
          <CardTitle className="text-lg leading-relaxed">{q.QUESTION_TEXT}</CardTitle>
          {isBlank && phase === "question" && <p className="text-xs text-muted-foreground mt-1">わからないだろう？</p>}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Blank chart (question phase only) */}
          {isBlank && q.SERIES && q.MASK_FROM != null && q.MASK_TO != null && phase === "question" && (
            <BlankChart series={q.SERIES} maskFrom={q.MASK_FROM} maskTo={q.MASK_TO} />
          )}

          {/* Question: High & Low buttons */}
          {phase === "question" && !isBlank && (
            <div className="grid grid-cols-2 gap-3">
              <Button size="lg" className="h-28 text-xl whitespace-normal" onClick={() => handleAnswer(0)}>
                <Badge className="mr-2">A</Badge>← {q.ITEM_A}
              </Button>
              <Button size="lg" variant="outline" className="h-28 text-xl whitespace-normal" onClick={() => handleAnswer(1)}>
                <Badge variant="outline" className="mr-2">B</Badge>{q.ITEM_B} →
              </Button>
            </div>
          )}

          {/* Question: Blank choice cards */}
          {phase === "question" && isBlank && q.CHOICES && (
            <div className="grid grid-cols-2 gap-3">
              {q.CHOICES.map((c, i) => (
                <button key={i} className="rounded-lg border p-4 text-center hover:ring-2 hover:ring-primary transition-all" onClick={() => handleAnswer(i)}>
                  <div className="text-sm font-semibold mb-1">{i % 2 === 0 ? "← " : ""}{String.fromCharCode(65 + i)}{i % 2 === 1 ? " →" : ""}</div>
                  <MiniLineChart points={c.series} width={120} height={50} strokeColor="var(--foreground)" />
                </button>
              ))}
            </div>
          )}

          {/* Moving phase */}
          {phase === "moving" && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-pulse text-lg font-bold text-muted-foreground">判定中...</div>
            </div>
          )}

          {/* Result phase */}
          {phase === "result" && (
            <div className="space-y-4">
              <div className={`rounded-lg p-4 text-center text-lg font-bold ${isCorrect ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"}`}>
                {isCorrect ? "正解!" : "不正解..."}
              </div>

              {/* High & Low values */}
              {!isBlank && (
                <div className="grid grid-cols-2 gap-3">
                  {[0, 1].map((idx) => (
                    <div key={idx} className={`rounded-lg border p-4 text-center ${q.CORRECT === idx ? "ring-2 ring-green-500" : ""}`}>
                      <p className="text-sm text-muted-foreground mb-1">{idx === 0 ? q.ITEM_A : q.ITEM_B}</p>
                      <p className="text-2xl font-bold tabular-nums">{formatNumber(idx === 0 ? q.VALUE_A : q.VALUE_B, q.METRIC)}</p>
                      {q.CORRECT === idx && <Badge className="mt-2 bg-green-600">正解</Badge>}
                    </div>
                  ))}
                </div>
              )}

              {/* Blank result: full chart + labels */}
              {isBlank && q.SERIES && (
                <div className="space-y-2">
                  <FullChart series={q.SERIES} />
                  {q.CHOICES && (
                    <div className="grid grid-cols-2 gap-2">
                      {q.CHOICES.map((c, i) => (
                        <div key={i} className={`rounded-lg border p-2 text-center text-xs ${i === q.CORRECT ? "ring-2 ring-green-500 font-bold" : "text-muted-foreground"}`}>
                          {String.fromCharCode(65 + i)}: {c.label}
                          {i === q.CORRECT && <Badge className="ml-1 bg-green-600 text-[10px]">正解</Badge>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {q.EXPLANATION && <div className="rounded-lg bg-muted p-4"><p className="text-sm whitespace-pre-wrap">{q.EXPLANATION}</p></div>}

              {q.SQL_TEXT && (
                <div>
                  <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setShowSql(!showSql)}>{showSql ? "SQL を閉じる" : "使った SQL を見る"}</button>
                  {showSql && <pre className="mt-2 rounded-lg bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap">{q.SQL_TEXT}</pre>}
                </div>
              )}

              <div>
                <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setShowDef(!showDef)}>{showDef ? "定義を閉じる" : "定義"}</button>
                {showDef && (
                  <div className="mt-2 rounded-lg bg-muted p-3 text-xs space-y-1">
                    <p>注文＝顧客ID × 購入日時</p>
                    <p>平均購入単価＝売上 ÷ 注文数</p>
                    <p>優良顧客＝Day3 の RFM 定義（化粧品購入者で R・F・M 高、2,865 人）</p>
                    <p>Apple Gift Card は集計から除外</p>
                    <p>期間 2023/4/1〜2024/3/31</p>
                  </div>
                )}
              </div>

              {/* Dobon banner */}
              {dobonEnd && (
                <div className="rounded-lg bg-red-600 text-white p-4 text-center text-xl font-black">ドボン！</div>
              )}

              <Button className="w-full" size="lg" onClick={handleNext}>{dobonEnd ? "結果を見る" : (currentIdx + 1 >= questions.length ? "結果を見る" : "次の問題")}</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
