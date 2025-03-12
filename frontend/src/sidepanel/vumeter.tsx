import React, {useEffect, useRef} from "react"
import "../index.css"
import {clamp} from "lodash"
import {cssStyles} from "../utilities/ui-components"
import {getLabelForChannel} from "../camilladsp/config"
import {Range} from "immutable"

export function VuMeterGroup(props: { title: string, levels: number[], peaks: number[], labels: null | (string|null)[] }) {
  const {title, levels, peaks, labels} = props
  const canvasRef = useRef(null)
  const meters = <canvas
      width={meterWidth + labelWidth+ 'px'}
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
    drawLabel(context, css, title, 0, 0)
    Range(0, levels.length).forEach(index => {
      const level = levels[index]
      const peak = peaks[index]
      const levelInPercent = levelAsPercent(level)
      const peakInPercent = levelAsPercent(peak)
      const clipped = peak >= 0
      fillBackground(context, css, index+1)
      drawLabel(context, css, getLabelForChannel(labels, index, true, false), index+1, 0)
      drawDbMarkers(context, css, index+1)
      draw0DbMarker(context, css, index+1)
      drawLevelBars(context, css, levelInPercent, peakInPercent, clipped, index+1)
    })
    drawDbMarkerLabels(context, css, 0)
    drawDbMarkerLabels(context, css, levels.length+1)
  }, [levels, peaks, labels, title])
  if (levels.length === 0 || levels.length !== peaks.length)
    return null
  else
    return (
        <div>
          {meters}
        </div>
    )
}

const meterHeightInPX = 10
const gapHeightInPX = 5
const dbMarkerLabelHeight = 10
const dbMarkersAt = [6, 0, -6, -12, -24, -48, -72, -96]
const dbMarkersWithTextLabel = [6, 0, -6, -12, -24, -48, -72, -96]
const labelWidth = 40
const meterWidth = 190

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

function fillBackground(context: any, css: CSSStyleDeclaration, index: number) {
  context.fillStyle = css.getPropertyValue('--button-background-color')
  context.fillRect(labelWidth, meterYOffset(index), meterWidth, meterHeightInPX)
}

function drawDbMarkers(context: any, css: CSSStyleDeclaration, index: number) {
  context.fillStyle = css.getPropertyValue('--text-color')
  dbMarkersAt.forEach(marker => {
    const x = labelWidth + meterWidth * levelAsPercent(marker) / 100 - 1
    const y = meterYOffset(index) - gapHeightInPX
    context.fillRect(x, y, 2, gapHeightInPX)
    context.fillRect(x, y + meterHeightInPX + gapHeightInPX, 2, gapHeightInPX)
  })
}

function drawDbMarkerLabels(context: any, css: CSSStyleDeclaration, index: number) {
  context.fillStyle = css.getPropertyValue('--text-color')
  const dbMarkerHeight = gapHeightInPX
  dbMarkersAt.forEach(marker => {
    const x = labelWidth + meterWidth * levelAsPercent(marker) / 100 - 1
    const y = meterYOffset(index) - dbMarkerHeight
    context.fillRect(x, y, 2, dbMarkerHeight)
    context.fillRect(x, y + meterHeightInPX + dbMarkerHeight, 2, dbMarkerHeight)
    if (dbMarkersWithTextLabel.includes(marker)) {
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.font = '10px Arial'
      context.fillText(marker.toString(10), x+1, y + gapHeightInPX + dbMarkerHeight + 1)
    }
  })
}

function drawLabel(context: any, css: CSSStyleDeclaration, label: string, index: number, x: number) {
  context.fillStyle = css.getPropertyValue('--text-color')
  const dbMarkerHeight = gapHeightInPX
  const y = meterYOffset(index) - dbMarkerHeight
  context.textAlign = 'middle'
  context.textBaseline = 'middle'
  context.font = '13px Arial'
  context.fillText(label, x+labelWidth/2, y + gapHeightInPX + dbMarkerHeight + 1, labelWidth)
}

function draw0DbMarker(context: any, css: CSSStyleDeclaration, index: number) {
  context.fillStyle = css.getPropertyValue('--text-color')
  context.fillRect(labelWidth + (meterWidth * levelAsPercent(0) / 100) - 1, meterYOffset(index), 2, meterHeightInPX)
}

function drawLevelBars(
    context: any,
    css: CSSStyleDeclaration,
    levelInPercent: number,
    peakInPercent: number,
    clipped: boolean,
    index: number
) {
  context.fillStyle = css.getPropertyValue(clipped ? '--error-text-color' : '--success-text-color')
  const rmsBarWidth = Math.round(meterWidth * levelInPercent / 100)
  context.fillRect(labelWidth, meterYOffset(index), rmsBarWidth, meterHeightInPX) // draw rms bar
  const peakX = labelWidth + Math.min(meterWidth - 2, Math.round(meterWidth * peakInPercent / 100 - 1))
  context.fillRect(peakX, meterYOffset(index), 2, meterHeightInPX) // draw peak bar
}
