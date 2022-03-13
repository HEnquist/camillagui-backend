import React, {useEffect, useRef} from "react"
import "../index.css"
import {clamp} from "lodash"
import {cssStyles} from "../utilities/ui-components"
import {Range} from "immutable"
import {minVolume} from "./volumebox"

export function VuMeterGroup(props: { title: string, levels: number[], peaks: number[], clipped: boolean}) {
  const {title, levels, peaks, clipped} = props
  const canvasRef = useRef(null)
  const meters = <canvas
      width='170px'
      height={levels.length * meterHeightInPX + levels.length * gapHeightInPX + dbMarkerLabelHeight + 'px'}
      ref={canvasRef}/>
  useEffect(() => {
    const canvas: any = canvasRef.current
    if (canvas === null)
      return
    const context = canvas.getContext('2d')
    const width = context.canvas.width
    const height = context.canvas.height
    const css = cssStyles()
    context.clearRect(0,0,width, height)
    Range(0, levels.length).forEach(index => {
      const level = levels[index]
      const peak = peaks[index]
      const levelInPercent = levelAsPercent(level)
      const peakInPercent = levelAsPercent(peak)
      fillBackground(context, css, width, height, index)
      drawDbMarkers(context, css, width, height, index)
      draw0dBmarker(context, css, width, height, index)
      drawLevelBars(context, width, height, css, levelInPercent, peakInPercent, clipped, index)
    })
    drawDbMarkerLabels(context, css, width, height, levels.length)
  }, [levels, peaks, clipped])
  if (levels.length === 0 || levels.length !== peaks.length)
    return null
  else
    return (
        <div className="split-20-80">
          <div>{title}</div>
          {meters}
        </div>
    )
}

const meterHeightInPX = 10
const gapHeightInPX = 5
const dbMarkerLabelHeight = 10
const dbMarkersAt = [6, 0, -6, -12, -18, -24, -30, -36, -42, -48]
const dbMarkersWithTextLabel = [0, -12, -24, -36, -48]

/**
 * Converts volume level to percent
 * -50dB ~= 0%
 * +10dB ~= 100%
 * @param dBFS
 */
export function levelAsPercent(dBFS: number): number {
  return (clamp(dBFS, minVolume, 10) - minVolume) * 100 / 60
}

function meterYOffset(index: number): number {
  return index * (meterHeightInPX + gapHeightInPX)
}

function fillBackground(context: any, css: CSSStyleDeclaration, width: number, height: number, index: number) {
  context.fillStyle = css.getPropertyValue('--button-background-color')
  context.fillRect(0, meterYOffset(index), width, meterHeightInPX)
}

function drawDbMarkers(context: any, css: CSSStyleDeclaration, width: number, height: number, index: number) {
  context.fillStyle = css.getPropertyValue('--text-color')
  dbMarkersAt.forEach(marker => {
    const x = width * levelAsPercent(marker) / 100 - 1
    const y = meterYOffset(index) - gapHeightInPX
    context.fillRect(x, y, 2, gapHeightInPX)
    context.fillRect(x, y + meterHeightInPX + gapHeightInPX, 2, gapHeightInPX)
  })
}

function drawDbMarkerLabels(context: any, css: CSSStyleDeclaration, width: number, height: number, index: number) {
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

function draw0dBmarker(context: any, css: CSSStyleDeclaration, width: number, height: number, index: number) {
  context.fillStyle = css.getPropertyValue('--text-color')
  context.fillRect((width * levelAsPercent(0) / 100) - 1, meterYOffset(index), 2, meterHeightInPX)
}

function drawLevelBars(context: any, width: number, height: number,
                  css: CSSStyleDeclaration,
                  levelInPercent: number, peakInPercent: number,
                  clipped: boolean, index: number) {
  context.fillStyle = css.getPropertyValue(clipped ? '--error-text-color' : '--success-text-color')
  const rmsBarWidth = Math.round(width * levelInPercent / 100)
  context.fillRect(0, meterYOffset(index), rmsBarWidth, meterHeightInPX) // draw rms bar
  const peakX = Math.min(width - 2, Math.round(width * peakInPercent / 100 - 1))
  context.fillRect(peakX, meterYOffset(index), 2, meterHeightInPX) // draw peak bar
}
