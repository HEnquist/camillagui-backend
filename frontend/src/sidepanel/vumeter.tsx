import React, {useEffect, useRef} from "react"
import "../index.css"
import {clamp} from "lodash"
import {cssStyles} from "../utilities/ui-components"
import {Range} from "immutable"

export function VuMeterGroup(props: { title: string, level: number[], peaks: number[], clipped: boolean, showLevelInDB: boolean }) {
  const { title, level, peaks, clipped, showLevelInDB } = props
  if (level.length === 0 || level.length !== peaks.length)
    return null
  const meters = Range(0, level.length).map((index) =>
      <VuMeter key={index} level={level[index]} peak={peaks[index]} clipped={clipped} showLevelInDB={showLevelInDB}/>
  )
  return (
      <div className="split-20-80">
        <div>{title}</div>
        <div>{meters}</div>
      </div>
  )
}

const rangeBeforeClipping = 0.9

function VuMeter(props: { level: number, peak: number, clipped: boolean, showLevelInDB: boolean }) {
  const {level, peak, clipped, showLevelInDB} = props
  const levelInPercent = levelAsPercent(level)
  const peakInPercent = levelAsPercent(peak)
  const canvasRef = useRef(null)
  const meter = <canvas
      width={showLevelInDB ? '120px' : '170px'}
      height='10px'
      ref={canvasRef}/>
  useEffect(() => {
    const canvas: any = canvasRef.current
    const context = canvas.getContext('2d')
    const width = context.canvas.width
    const height = context.canvas.height
    const css = cssStyles()
    fillBackground(context, css, width, height)
    draw0dBmarker(context, css, width, height)
    drawBars(context, width, height, css, levelInPercent, peakInPercent, clipped)
  }, [levelInPercent, peakInPercent, clipped])
  return showLevelInDB ?
      <div style={{display: 'flex'}}>
        <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center'}}>{meter}</div>
        <div style={{textAlign: 'right', flexGrow: 1}}>
          {level < -99 ? '' : level.toFixed(0)}dB
        </div>
      </div>
      : meter
}

function levelAsPercent(level: number): number {
  const levelWithClippingBuffer = (level + 100) * rangeBeforeClipping - 100
  return clamp(levelWithClippingBuffer, -100, 0) + 100
}

function fillBackground(context: any, css: CSSStyleDeclaration, width: number, height: number) {
  context.fillStyle = css.getPropertyValue('--button-background-color')
  context.fillRect(0, 0, width, height)
}

function draw0dBmarker(context: any, css: CSSStyleDeclaration, width: number, height: number) {
  context.fillStyle = css.getPropertyValue('--text-color')
  context.fillRect((width * rangeBeforeClipping) - 1, 0, 2, height)
}

function drawBars(context: any, width: number, height: number,
                  css: CSSStyleDeclaration,
                  levelInPercent: number, peakInPercent: number,
                  clipped: boolean) {
  context.fillStyle = cssStyles().getPropertyValue(clipped ? '--error-text-color' : '--success-text-color')
  context.fillRect(0, 0, width * levelInPercent / 100, height) // draw rms bar
  context.fillRect(Math.min(width - 2, width * peakInPercent / 100), 0, 2, height) // draw peak bar
}
