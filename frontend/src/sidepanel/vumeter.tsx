import React, {useEffect, useRef} from "react"
import "../index.css"
import {clamp} from "lodash"
import {cssStyles} from "../utilities/ui-components"
import {Range} from "immutable"

export function VuMeterGroup(props: { title: string, levels: number[], peaks: number[] }) {
  const {title, levels, peaks} = props
  const canvasRef = useRef(null)
  const meters = <canvas
      width='184px'
      height={levels.length * meterHeightInPX + (levels.length+1) * gapHeightInPX + 2*dbMarkerLabelHeight + 'px'}
      ref={canvasRef}/>
  useEffect(() => {
    const canvas: any = canvasRef.current
    if (canvas === null)
      return
    const context = canvas.getContext('2d')
    const width = context.canvas.width
    const css = cssStyles()
    context.clearRect(0,0,width, context.canvas.height)
    Range(0, levels.length).forEach(index => {
      const level = levels[index]
      const peak = peaks[index]
      const levelInPercent = levelAsPercent(level)
      const peakInPercent = levelAsPercent(peak)
      const clipped = peak >= 0
      fillBackground(context, css, width, index+1)
      drawDbMarkers(context, css, width, index+1)
      draw0DbMarker(context, css, width, index+1)
      drawLevelBars(context, width, css, levelInPercent, peakInPercent, clipped, index+1)
    })
    drawDbMarkerLabels(context, css, width, 0)
    drawDbMarkerLabels(context, css, width, levels.length+1)
  }, [levels, peaks])
  if (levels.length === 0 || levels.length !== peaks.length)
    return null
  else
    return (
        <div className="split-10-90">
          <div className="vertical-text">{title}</div>
          {meters}
        </div>
    )
}

const meterHeightInPX = 10
const gapHeightInPX = 5
const dbMarkerLabelHeight = 10
const dbMarkersAt = [6, 0, -6, -12, -24, -48, -72, -96]
const dbMarkersWithTextLabel = [6, 0, -6, -12, -24, -48, -72, -96]

/**
 * Converts volume level to percent
 * Piecewise linear with 24 dB per division at low level, 12 dB in between, and 6 dB per division at high level.
 * -108dB --> 0%, +9dB --> 100%
 * @param dBFS
 */
export function levelAsPercent(dBFS: number): number {
  let value: number
  if (dBFS >= -12)
    value = 81.25 + 12.5*dBFS/6
  else if (dBFS >= -24)
    value = 68.75 + 12.5*dBFS/12
  else
    value = 56.25 + 12.5*dBFS/24
  return clamp(value, 0, 100)
}

function meterYOffset(index: number): number {
  return index * (meterHeightInPX + gapHeightInPX)
}

function fillBackground(context: any, css: CSSStyleDeclaration, width: number, index: number) {
  context.fillStyle = css.getPropertyValue('--button-background-color')
  context.fillRect(0, meterYOffset(index), width, meterHeightInPX)
}

function drawDbMarkers(context: any, css: CSSStyleDeclaration, width: number, index: number) {
  context.fillStyle = css.getPropertyValue('--text-color')
  dbMarkersAt.forEach(marker => {
    const x = width * levelAsPercent(marker) / 100 - 1
    const y = meterYOffset(index) - gapHeightInPX
    context.fillRect(x, y, 2, gapHeightInPX)
    context.fillRect(x, y + meterHeightInPX + gapHeightInPX, 2, gapHeightInPX)
  })
}

function drawDbMarkerLabels(context: any, css: CSSStyleDeclaration, width: number, index: number) {
  context.fillStyle = css.getPropertyValue('--text-color')
  const dbMarkerHeight = gapHeightInPX
  dbMarkersAt.forEach(marker => {
    const x = width * levelAsPercent(marker) / 100 - 1
    const y = meterYOffset(index) - dbMarkerHeight
    context.fillRect(x, y, 2, dbMarkerHeight)
    context.fillRect(x, y + meterHeightInPX + dbMarkerHeight, 2, dbMarkerHeight)
    if (dbMarkersWithTextLabel.includes(marker)) {
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.font = 'Arial'
      context.fillText(marker.toString(10), x+1, y + gapHeightInPX + dbMarkerHeight + 1)
    }
  })
}

function draw0DbMarker(context: any, css: CSSStyleDeclaration, width: number, index: number) {
  context.fillStyle = css.getPropertyValue('--text-color')
  context.fillRect((width * levelAsPercent(0) / 100) - 1, meterYOffset(index), 2, meterHeightInPX)
}

function drawLevelBars(
    context: any,
    width: number,
    css: CSSStyleDeclaration,
    levelInPercent: number,
    peakInPercent: number,
    clipped: boolean,
    index: number
) {
  context.fillStyle = css.getPropertyValue(clipped ? '--error-text-color' : '--success-text-color')
  const rmsBarWidth = Math.round(width * levelInPercent / 100)
  context.fillRect(0, meterYOffset(index), rmsBarWidth, meterHeightInPX) // draw rms bar
  const peakX = Math.min(width - 2, Math.round(width * peakInPercent / 100 - 1))
  context.fillRect(peakX, meterYOffset(index), 2, meterHeightInPX) // draw peak bar
}
