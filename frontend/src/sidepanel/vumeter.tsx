import React from "react"
import "../index.css"
import {Line} from "rc-progress"
import {clamp} from "lodash"

export function VuMeterGroup(props: { title: string, level: number[], clipped: boolean, showLevelInDB: boolean }) {
  if (props.level.length === 0)
    return null
  const meters = props.level.map((value, idx) =>
      <VuMeter key={idx} level={value} clipped={props.clipped} showLevelInDB={props.showLevelInDB}/>
  )
  return (
      <div className="split-20-80">
        <div>{props.title}</div>
        <div>{meters}</div>
      </div>
  )
}

function VuMeter(props: { level: number, clipped: boolean, showLevelInDB: boolean }) {
  const {level, clipped, showLevelInDB} = props
  const color = clipped ? 'var(--error-text-color)' : 'var(--success-text-color)'
  const levelInPercent = clamp(level, -100, 0) + 100
  const meter = <Line
      percent={levelInPercent}
      strokeWidth={showLevelInDB ? 5 : 4}
      trailWidth={showLevelInDB ? 5 : 4}
      strokeColor={color}
      strokeLinecap="square"
      trailColor="#E9E9E9"/>
  return showLevelInDB ?
      <div style={{display: 'flex'}}>
        <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center'}}>{meter}</div>
        <div style={{width: '10ch', textAlign: 'right', marginLeft: '5px'}}>
          {level < -99 ? '' : level.toFixed(0)}dB
        </div>
      </div>
      : meter;
}
