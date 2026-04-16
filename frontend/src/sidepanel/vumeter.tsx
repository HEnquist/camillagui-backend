import React, { useEffect, useMemo, useRef, useState } from "react"
import "../index.css"
import { Range } from "immutable"
import { clamp } from "lodash"
import { getLabelForChannel } from "../camilladsp/config"
import { cssStyles } from "../utilities/ui-components"

export interface VuMeterSize {
  width: number
  channelHeight: number
}

type VuMeterLayout = VuMeterSize & {
  gapHeight: number
  dbMarkerLabelHeight: number
  dbMarkerTickHeight: number
  peakBarWidth: number
  totalHeight: number
  labelWidth: number
  levelLabelWidth: number
  peakLabelWidth: number
  valueDecimals: number
  channelFontSize: number
  dbMarkerFontSize: number
  dbLabelOffsetStep: number
  dbLabelExtraExpandedOffset: number
  meterWidth: number
  meterBarWidth: number
  dbMarkerXs: number[]
  labelColumn: { x: number; maxWidth: number; align: CanvasTextAlign }
  levelColumn: { x: number; maxWidth: number; align: CanvasTextAlign }
  peakColumn: { x: number; maxWidth: number; align: CanvasTextAlign }
}

export function VuMeterGroup(props: {
  title: string
  levels: number[]
  peaks: number[]
  labels: null | (string | null)[]
  size?: Partial<VuMeterSize>
}) {
  const { title, levels, peaks, labels, size } = props
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const dynamicCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [displayedLevels, setDisplayedLevels] = useState<number[]>(levels)
  const [displayedPeaks, setDisplayedPeaks] = useState<number[]>(peaks)
  const layout = useMemo(() => makeMeterLayout(size, levels.length), [size, levels.length])
  useUpdatePeakAndLevelLabelsEvery500ms(levels, setDisplayedLevels, peaks, setDisplayedPeaks)
  useEffect(() => {
    const canvas = staticCanvasRef.current
    if (canvas === null) return
    const context = canvas.getContext("2d")
    if (context === null) return
    const width = context.canvas.width
    const css = cssStyles()
    context.clearRect(0, 0, width, context.canvas.height)
    drawChannelLabel(context, css, layout, title, 0)
    drawChannelLevel(context, css, layout, "LV", 0)
    drawChannelPeak(context, css, layout, "PK", 0)
    Range(0, levels.length).forEach((index) => {
      fillBackground(context, css, layout, index + 1)
      drawChannelLabel(context, css, layout, getLabelForChannel(labels, index, true, false), index + 1)
      drawDbMarkers(context, css, layout, index + 1)
      draw0DbMarker(context, css, layout, index + 1)
    })
    drawDbMarkerLabels(context, css, layout, 0)
    drawDbMarkerLabels(context, css, layout, levels.length + 1)
  }, [labels, title, levels.length, layout])

  useEffect(() => {
    const canvas = dynamicCanvasRef.current
    if (canvas === null) return
    const context = canvas.getContext("2d")
    if (context === null) return
    const width = context.canvas.width
    const css = cssStyles()
    context.clearRect(0, 0, width, context.canvas.height)
    Range(0, levels.length).forEach((index) => {
      const level = levels[index]
      const peak = peaks[index]
      const displayedLevel = displayedLevels[index]
      const displayedPeak = displayedPeaks[index]
      const levelInPercent = levelAsPercent(level)
      const peakInPercent = levelAsPercent(peak)
      const levelText = formatDisplayedValue(displayedLevel, layout.valueDecimals)
      const peakText = formatDisplayedValue(displayedPeak, layout.valueDecimals)
      const clipped = peak > 0
      drawLevelBars(context, css, layout, levelInPercent, peakInPercent, clipped, index + 1)
      drawChannelLevel(context, css, layout, levelText, index + 1)
      drawChannelPeak(context, css, layout, peakText, index + 1)
    })
  }, [levels, peaks, displayedLevels, displayedPeaks, layout])
  const meters = (
    <div style={{ position: "relative", width: layout.width + "px", height: layout.totalHeight + "px" }}>
      <canvas
        width={layout.width}
        height={layout.totalHeight}
        style={{ width: layout.width + "px", position: "absolute", inset: 0 }}
        ref={staticCanvasRef}
      />
      <canvas
        width={layout.width}
        height={layout.totalHeight}
        style={{ width: layout.width + "px", position: "absolute", inset: 0 }}
        ref={dynamicCanvasRef}
      />
    </div>
  )
  if (levels.length === 0 || levels.length !== peaks.length) return null
  else return <div style={{ width: layout.width + "px" }}>{meters}</div>
}

function useUpdatePeakAndLevelLabelsEvery500ms(
  levels: number[],
  setDisplayedLevels: (value: ((prevState: number[]) => number[]) | number[]) => void,
  peaks: number[],
  setDisplayedPeaks: (value: ((prevState: number[]) => number[]) | number[]) => void,
) {
  const lastUpdateRef = useRef(0)
  const levelsAccumRef = useRef<number[]>([])
  const peaksAccumRef = useRef<number[]>([])
  const countRef = useRef(0)

  useEffect(() => {
    if (levelsAccumRef.current.length !== levels.length) {
      levelsAccumRef.current = new Array(levels.length).fill(0)
      peaksAccumRef.current = new Array(levels.length).fill(-Infinity)
    }
    const count = countRef.current
    const levelsAccum = levelsAccumRef.current
    const peaksAccum = peaksAccumRef.current

    for (let i = 0; i < levels.length; i++) {
      levelsAccum[i] = count === 0 ? levels[i] : ((count - 1) * levelsAccum[i] + levels[i]) / count // cumulative mean
      peaksAccum[i] = Math.max(peaksAccum[i], peaks[i])
    }
    countRef.current++

    const now = Date.now()
    if (now - lastUpdateRef.current >= 500) {
      lastUpdateRef.current = now
      setDisplayedLevels([...levelsAccum])
      setDisplayedPeaks([...peaksAccum])
      levelsAccum.fill(0)
      peaksAccum.fill(-Infinity)
      countRef.current = 0
    }
  }, [levels, setDisplayedLevels, peaks, setDisplayedPeaks])
}

const defaultMeterWidth = 290
const defaultChannelHeight = 10
const gapHeightInPX = 5
const minDbMarkerLabelHeight = 10
const dbMarkersAt = [6, 0, -6, -12, -24, -48, -72, -96]
const dbMarkersWithTextLabel = [6, 0, -6, -12, -24, -48, -72, -96]
const labelWidth = 40
const minLevelLabelWidth = 20
const minPeakLabelWidth = 20

function makeMeterLayout(size: Partial<VuMeterSize> | undefined, channelCount: number): VuMeterLayout {
  const width = size?.width ?? defaultMeterWidth
  const channelHeight = size?.channelHeight ?? defaultChannelHeight
  const widthGrowth = Math.max(0, width - defaultMeterWidth)
  const levelLabelWidth = minLevelLabelWidth + Math.round(widthGrowth * 0.08)
  const peakLabelWidth = minPeakLabelWidth + Math.round(widthGrowth * 0.08)
  const meterWidth = Math.max(width - labelWidth, levelLabelWidth + peakLabelWidth + 20)
  const valueDecimals = widthGrowth > 0 || channelHeight > defaultChannelHeight ? 1 : 0
  const channelFontSize = Math.max(13, Math.min(Math.round(channelHeight * 0.7) + 2, 19))
  const dbMarkerFontSize = Math.max(10, Math.min(Math.round(channelHeight * 0.8), 16))
  const dbMarkerLabelHeight = Math.max(minDbMarkerLabelHeight, dbMarkerFontSize + 6)
  const dbMarkerTickHeight = channelHeight > defaultChannelHeight ? gapHeightInPX : Math.max(3, gapHeightInPX - 2)
  const peakBarWidth = channelHeight > defaultChannelHeight ? 4 : 2
  const meterBarWidth = meterWidth - levelLabelWidth - peakLabelWidth
  const dbLabelOffsetStep = Math.max(1, Math.round(dbMarkerFontSize / 10))
  const dbLabelExtraExpandedOffset = channelHeight > defaultChannelHeight ? dbLabelOffsetStep : 0
  const dbMarkerXs = dbMarkersAt.map((marker) => labelWidth + (meterBarWidth * levelAsPercent(marker)) / 100 - 1)
  const labelColumn = { x: labelWidth / 2, maxWidth: labelWidth, align: "center" as CanvasTextAlign }
  const levelColumn = {
    x: labelWidth + meterBarWidth + levelLabelWidth,
    maxWidth: levelLabelWidth,
    align: "right" as CanvasTextAlign,
  }
  const peakColumn = {
    x: labelWidth + meterWidth,
    maxWidth: peakLabelWidth,
    align: "right" as CanvasTextAlign,
  }
  const totalHeight = channelCount * channelHeight + (channelCount + 1) * gapHeightInPX + 2 * dbMarkerLabelHeight
  return {
    width,
    channelHeight,
    gapHeight: gapHeightInPX,
    dbMarkerLabelHeight,
    dbMarkerTickHeight,
    peakBarWidth,
    totalHeight,
    labelWidth,
    levelLabelWidth,
    peakLabelWidth,
    valueDecimals,
    channelFontSize,
    dbMarkerFontSize,
    dbLabelOffsetStep,
    dbLabelExtraExpandedOffset,
    meterWidth,
    meterBarWidth,
    dbMarkerXs,
    labelColumn,
    levelColumn,
    peakColumn,
  }
}

function formatDisplayedValue(value: number, decimals: number): string {
  if (value < -99) return "---"
  return decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString()
}

/**
 * Converts volume level to percent
 * Piecewise linear with 24 dB per division at low level, 12 dB in between, and 6 dB per division at high level.
 * -108dB --> 0%, +9dB --> 100%
 * @param dBFS
 */
export function levelAsPercent(dBFS: number): number {
  let value: number
  if (dBFS >= -12) value = 81.25 + (12.5 * dBFS) / 6
  else if (dBFS >= -24) value = 68.75 + (12.5 * dBFS) / 12
  else value = 56.25 + (12.5 * dBFS) / 24
  return clamp(value, 0, 100)
}

function meterYOffset(layout: VuMeterLayout, index: number): number {
  return index * (layout.channelHeight + layout.gapHeight)
}

function fillBackground(
  context: CanvasRenderingContext2D,
  css: CSSStyleDeclaration,
  layout: VuMeterLayout,
  index: number,
) {
  context.fillStyle = css.getPropertyValue("--button-background-color")
  context.fillRect(layout.labelWidth, meterYOffset(layout, index), layout.meterBarWidth, layout.channelHeight)
}

function topTickY(layout: VuMeterLayout, index: number, tickHeight: number): number {
  return meterYOffset(layout, index) - tickHeight
}

function bottomTickY(layout: VuMeterLayout, index: number): number {
  return meterYOffset(layout, index) + layout.channelHeight
}

function labelRowTickY(layout: VuMeterLayout, index: number, tickHeight: number): number {
  return index === 0 ? topTickY(layout, 1, tickHeight) : bottomTickY(layout, index - 1)
}

function channelTextY(layout: VuMeterLayout, index: number): number {
  return meterYOffset(layout, index) + layout.channelHeight / 2
}

function dbLabelTextY(layout: VuMeterLayout, index: number, tickHeight: number): number {
  const y = topTickY(layout, index, tickHeight)
  return (
    y +
    layout.gapHeight +
    tickHeight +
    Math.max(1, Math.round(layout.channelHeight / 8)) +
    layout.dbLabelOffsetStep +
    layout.dbLabelExtraExpandedOffset
  )
}

function drawDbMarkers(
  context: CanvasRenderingContext2D,
  css: CSSStyleDeclaration,
  layout: VuMeterLayout,
  index: number,
) {
  context.fillStyle = css.getPropertyValue("--text-color")
  layout.dbMarkerXs.forEach((x) => {
    context.fillRect(x, topTickY(layout, index, layout.dbMarkerTickHeight), 2, layout.dbMarkerTickHeight)
    context.fillRect(x, bottomTickY(layout, index), 2, layout.dbMarkerTickHeight)
  })
}

function drawDbMarkerLabels(
  context: CanvasRenderingContext2D,
  css: CSSStyleDeclaration,
  layout: VuMeterLayout,
  index: number,
) {
  context.fillStyle = css.getPropertyValue("--text-color")
  const dbMarkerHeight = layout.dbMarkerTickHeight
  dbMarkersAt.forEach((marker, markerIndex) => {
    const x = layout.dbMarkerXs[markerIndex]
    context.fillRect(x, labelRowTickY(layout, index, dbMarkerHeight), 2, dbMarkerHeight)
    if (dbMarkersWithTextLabel.includes(marker)) {
      context.textAlign = "center"
      context.textBaseline = "middle"
      context.font = `${layout.dbMarkerFontSize}px Arial`
      context.fillText(marker.toString(10), x + 1, dbLabelTextY(layout, index, dbMarkerHeight))
    }
  })
}

function drawChannelText(
  context: CanvasRenderingContext2D,
  css: CSSStyleDeclaration,
  layout: VuMeterLayout,
  label: string,
  index: number,
  x: number,
  maxWidth: number,
  align: CanvasTextAlign,
) {
  context.fillStyle = css.getPropertyValue("--text-color")
  context.textAlign = align
  context.textBaseline = "middle"
  context.font = `${layout.channelFontSize}px Arial`
  context.fillText(label, x, channelTextY(layout, index), maxWidth)
}

function drawChannelLabel(
  context: CanvasRenderingContext2D,
  css: CSSStyleDeclaration,
  layout: VuMeterLayout,
  label: string,
  index: number,
) {
  const column = layout.labelColumn
  drawChannelText(context, css, layout, label, index, column.x, column.maxWidth, column.align)
}

function drawChannelLevel(
  context: CanvasRenderingContext2D,
  css: CSSStyleDeclaration,
  layout: VuMeterLayout,
  label: string,
  index: number,
) {
  const column = layout.levelColumn
  drawChannelText(context, css, layout, label, index, column.x, column.maxWidth, column.align)
}

function drawChannelPeak(
  context: CanvasRenderingContext2D,
  css: CSSStyleDeclaration,
  layout: VuMeterLayout,
  label: string,
  index: number,
) {
  const column = layout.peakColumn
  drawChannelText(context, css, layout, label, index, column.x, column.maxWidth, column.align)
}

function draw0DbMarker(
  context: CanvasRenderingContext2D,
  css: CSSStyleDeclaration,
  layout: VuMeterLayout,
  index: number,
) {
  context.fillStyle = css.getPropertyValue("--text-color")
  context.fillRect(
    layout.labelWidth + (layout.meterBarWidth * levelAsPercent(0)) / 100 - 1,
    meterYOffset(layout, index),
    2,
    layout.channelHeight,
  )
}

function drawLevelBars(
  context: CanvasRenderingContext2D,
  css: CSSStyleDeclaration,
  layout: VuMeterLayout,
  levelInPercent: number,
  peakInPercent: number,
  clipped: boolean,
  index: number,
) {
  context.fillStyle = css.getPropertyValue(clipped ? "--error-text-color" : "--success-text-color")
  const rmsBarWidth = Math.round((layout.meterBarWidth * levelInPercent) / 100)
  context.fillRect(layout.labelWidth, meterYOffset(layout, index), rmsBarWidth, layout.channelHeight) // draw rms bar
  const peakX =
    layout.labelWidth +
    Math.min(
      layout.meterBarWidth - layout.peakBarWidth,
      Math.round((layout.meterBarWidth * peakInPercent) / 100 - layout.peakBarWidth / 2),
    )
  context.fillRect(peakX, meterYOffset(layout, index), layout.peakBarWidth, layout.channelHeight) // draw peak bar
}
