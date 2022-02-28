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

function VuMeter(props: { level: number, peak: number, clipped: boolean, showLevelInDB: boolean }) {
  const {level, peak, clipped, showLevelInDB} = props
  const levelInPercent = clamp(level, -100, 0) + 100
  const peakInPercent = clamp(peak, -100, 0) + 100
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
    context.fillStyle = cssStyles().getPropertyValue('--button-background-color') // background color
    context.fillRect(0, 0, width, height) // fill background
    context.fillStyle = cssStyles().getPropertyValue(clipped ? '--error-text-color' : '--success-text-color') // bar color
    context.fillRect(0, 0, width*levelInPercent/100, height) // draw rms bar
    context.fillRect(Math.min(width-2, width*peakInPercent/100), 0, 2, height) // draw peak bar
  }, [levelInPercent, peakInPercent, clipped])
  return showLevelInDB ?
      <div style={{display: 'flex'}}>
        <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center'}}>{meter}</div>
        <div style={{textAlign: 'right', flexGrow: 1}}>
          {level < -99 ? '' : level.toFixed(0)}dB
        </div>
      </div>
      : meter;
}