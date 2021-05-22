import React from "react"
import "./index.css"
import {Line} from "rc-progress"

export function VuMeterGroup(props: { title: string, level: number[], clipped: boolean }) {
  if (props.level.length === 0)
    return null
  const meters = props.level.map((value, idx) =>
      <VuMeter key={idx} level={value} clipped={props.clipped}/>
  )
  return (
      <div className="split-20-80">
        <div>{props.title}</div>
        <div>{meters}</div>
      </div>
  )
}

export function VuMeter(props: { level: number, clipped: boolean}) {
  const color = props.clipped ? 'var(--error-text-color)' : 'var(--success-text-color)'
  let level = props.level
  if (level < -100) level = -100
  if (level > 0) level = 0
  level = level + 100
  return <Line
      percent={level}
      strokeWidth={4}
      trailWidth={4}
      strokeColor={color}
      strokeLinecap="square"
      trailColor="#E9E9E9"
  />
}
