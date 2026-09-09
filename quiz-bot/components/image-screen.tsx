"use client"

import { useState } from "react"

interface Hotspot {
  left: string; top: string; width: string; height: string
  onClick: () => void
  label?: string
  highlight?: boolean
}

export function ImageScreen({
  src,
  hotspots,
  children,
}: {
  src: string
  hotspots?: Hotspot[]
  children?: React.ReactNode
}) {
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <div className="relative" style={{ width: "min(100vw, 177.8vh)", aspectRatio: "16/9" }}>
        {!imgFailed && (
          <img
            src={src}
            alt=""
            className="absolute inset-0 z-0 w-full h-full object-contain pointer-events-none"
            onError={() => setImgFailed(true)}
          />
        )}
        {imgFailed && (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
            <p className="text-white/40 text-sm">画像なし</p>
          </div>
        )}
        {hotspots?.map((h, i) => (
          <button
            key={i}
            onClick={h.onClick}
            className="absolute z-20 transition-all hover:shadow-[inset_0_0_0_3px_rgba(255,255,255,0.5)] rounded-lg"
            style={{
              left: h.left, top: h.top, width: h.width, height: h.height,
              boxShadow: h.highlight ? "inset 0 0 0 3px #fbbf24" : undefined,
            }}
            aria-label={h.label}
          />
        ))}
        {imgFailed && children && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
