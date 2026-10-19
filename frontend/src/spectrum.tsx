import React, { useEffect, useMemo, useRef } from "react"
import "./index.css"
import { SpectrumEvent } from "./camilladsp/status"
import { cssStyles } from "./utilities/ui-components"

// Layout constants (pixels)
const plotLeft = 36 // room for dB labels
const plotRight = 8
const plotTop = 6
const plotBottom = 22 // room for frequency labels
const plotH = 160
const totalHeight = plotTop + plotH + plotBottom

const barGap = 1 // px subtracted from each side of every bar

const dbGridStep = 20
const freqTicksAt = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
const axisFontSize = 11

type SpectrumLayout = {
  width: number
  plotW: number
  minFreq: number
  maxFreq: number
  minDb: number
  maxDb: number
}

function makeLayout(width: number, minFreq: number, maxFreq: number, minDb: number, maxDb: number): SpectrumLayout {
  return { width, plotW: width - plotLeft - plotRight, minFreq, maxFreq, minDb, maxDb }
}

function freqToX(layout: SpectrumLayout, freq: number, nBins = 0): number {
  const logRange = Math.log10(layout.maxFreq / layout.minFreq)
  const t = Math.log10(freq / layout.minFreq) / logRange
  if (nBins > 0) {
    // Shift so minFreq/maxFreq land at the centres of the edge bars
    return plotLeft + ((0.5 + (nBins - 1) * t) * layout.plotW) / nBins
  }
  return plotLeft + layout.plotW * t
}

function dbToY(layout: SpectrumLayout, db: number): number {
  return plotTop + plotH * ((layout.maxDb - db) / (layout.maxDb - layout.minDb))
}

function formatFreq(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`
}

function draw(
  context: CanvasRenderingContext2D,
  css: CSSStyleDeclaration,
  layout: SpectrumLayout,
  data: SpectrumEvent,
) {
  const { width, plotW, minFreq, maxFreq, minDb, maxDb } = layout
  const textColor = css.getPropertyValue("--text-color")

  context.clearRect(0, 0, width, totalHeight)

  // Plot background
  context.fillStyle = css.getPropertyValue("--button-background-color")
  context.fillRect(plotLeft, plotTop, plotW, plotH)

  // dB grid lines
  context.fillStyle = textColor
  context.globalAlpha = 0.25
  const gridStart = Math.ceil(minDb / dbGridStep) * dbGridStep
  for (let db = gridStart; db <= maxDb; db += dbGridStep) {
    const y = Math.round(dbToY(layout, db))
    context.fillRect(plotLeft, y, plotW, 1)
  }
  context.globalAlpha = 1

  // Spectrum bars
  const { frequencies, magnitudes } = data
  const n = Math.min(frequencies.length, magnitudes.length)
  if (n > 0) {
    const barWidth = plotW / n
    const yBottom = plotTop + plotH
    for (let i = 0; i < n; i++) {
      const mag = magnitudes[i]
      context.fillStyle = css.getPropertyValue(mag > 0 ? "--error-text-color" : "--success-text-color")
      const xLeft = plotLeft + i * barWidth + barGap
      const xRight = plotLeft + (i + 1) * barWidth - barGap
      const yTop = Math.max(plotTop, Math.min(yBottom, dbToY(layout, mag)))
      if (xRight > xLeft && yBottom > yTop) {
        context.fillRect(xLeft, yTop, xRight - xLeft, yBottom - yTop)
      }
    }
  }

  // Axis labels and tick marks
  context.font = `${axisFontSize}px Arial`
  context.fillStyle = textColor

  context.textBaseline = "middle"
  context.textAlign = "right"
  for (let db = gridStart; db <= maxDb; db += dbGridStep) {
    const y = Math.round(dbToY(layout, db))
    context.fillText(db.toString(), plotLeft - 4, y)
  }

  context.textBaseline = "top"
  context.textAlign = "center"
  freqTicksAt.forEach((freq) => {
    if (freq < minFreq || freq > maxFreq) return
    const x = Math.round(freqToX(layout, freq, n))
    context.fillRect(x, plotTop + plotH, 1, 4)
    context.fillText(formatFreq(freq), x, plotTop + plotH + 6)
  })
}

export function SpectrumDisplay(props: {
  data: SpectrumEvent
  minDb: number
  maxDb: number
  minFreq: number
  maxFreq: number
  width?: number
}) {
  const { data, minDb, maxDb, minFreq, maxFreq } = props
  const width = props.width ?? 600
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const layout = useMemo(
    () => makeLayout(width, minFreq, maxFreq, minDb, maxDb),
    [width, minFreq, maxFreq, minDb, maxDb],
  )

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    draw(ctx, cssStyles(), layout, data)
  }, [layout, data])

  return <canvas width={width} height={totalHeight} style={{ display: "block" }} ref={canvasRef} />
}
