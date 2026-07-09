"use client"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { Play, Pause, SkipBack, SkipForward, Gauge } from "lucide-react"
import { useState } from "react"

export type ReplaySpeed = 0.5 | 1 | 2 | 0 // 0 = instant

interface Props {
  isReplay: boolean
  isPlaying: boolean
  progress: number // 0..1
  currentIdx: number
  total: number
  speed: ReplaySpeed
  onTogglePlay: () => void
  onSeek: (idx: number) => void
  onSpeed: (s: ReplaySpeed) => void
  onExit: () => void
}

export function ReplayControls(props: Props) {
  const { isReplay, isPlaying, progress, currentIdx, total, speed, onTogglePlay, onSeek, onSpeed, onExit } = props
  const [speedOpen, setSpeedOpen] = useState(false)

  if (!isReplay) return null

  const speeds: ReplaySpeed[] = [0.5, 1, 2, 0]

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card/80 backdrop-blur px-3 py-2">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onSeek(0)} title="Restart">
        <SkipBack className="h-4 w-4" />
      </Button>
      <Button
        variant="default"
        size="icon"
        className="h-9 w-9 rounded-full"
        onClick={onTogglePlay}
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onSeek(total - 1)} title="Skip to end">
        <SkipForward className="h-4 w-4" />
      </Button>

      <div className="flex-1 min-w-[120px] flex items-center gap-2">
        <Slider
          value={[Math.round(progress * 100)]}
          max={100}
          step={1}
          onValueChange={(v) => onSeek(Math.floor((v[0] / 100) * Math.max(1, total - 1)))}
          className="flex-1"
        />
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums w-16 text-right">
          {currentIdx + 1}/{total}
        </span>
      </div>

      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 font-mono text-xs"
          onClick={() => setSpeedOpen((v) => !v)}
        >
          <Gauge className="h-3.5 w-3.5" />
          {speed === 0 ? "inst" : `${speed}x`}
        </Button>
        {speedOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setSpeedOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-40 rounded-md border border-border bg-popover p-1 shadow-lg min-w-[88px]">
              {speeds.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    onSpeed(s)
                    setSpeedOpen(false)
                  }}
                  className={cn(
                    "w-full text-left px-2.5 py-1.5 rounded text-xs font-mono hover:bg-accent",
                    s === speed && "text-primary"
                  )}
                >
                  {s === 0 ? "instant" : `${s}x`}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onExit}>
        Exit
      </Button>
    </div>
  )
}
