import React, {useCallback, useMemo, useRef} from "react"
import {Scatter} from "react-chartjs-2"
import {mdiHome, mdiImage, mdiTable} from "@mdi/js"
import ReactTooltip from "react-tooltip"
import {CloseButton, cssStyles, MdiButton} from "./ui-components"
import Popup from "reactjs-popup"
import {Chart as ChartJS, Legend, LinearScale, LineElement, LogarithmicScale, PointElement, Tooltip} from "chart.js"
import zoomPlugin from "chartjs-plugin-zoom"

ChartJS.register(LinearScale, LogarithmicScale, PointElement, LineElement, Tooltip, Legend, zoomPlugin)

export function ChartPopup(props: {
  open: boolean
  data: ChartData
  onChange: (item: string) => void
  onClose: () => void
}) {
  return <Popup open={props.open} onClose={props.onClose}>
    <CloseButton onClick={props.onClose}/>
    <h3 style={{textAlign: 'center'}}>{props.data.name}</h3>
    <Chart onChange={props.onChange} data={props.data}/>
  </Popup>
}

export interface ChartData {
  name: string
  samplerate?: number
  channels?: number
  options: FilterOption[]
  f: number[]
  magnitude?: number[]
  phase?: number[]
  impulse?: number[]
  time: number[]
  groupdelay?: number[]
  f_groupdelay?: number[]
}

export interface FilterOption {
  name: string
  channels?: number
  samplerate?: number
}

export function Chart(props: {
  data: ChartData
  onChange: (item: string) => void
}) {
  const chartRef = useRef(null)
  const downloadPlot = useCallback(() => {
    const link = document.createElement('a')
    link.download = props.data.name.replace(/\s/g, "_") + ".png"

    if (chartRef.current !== null) {
      let current = chartRef.current as any
      link.href = current.toBase64Image()
      link.click()
    }
  }, [props.data.name])

  const resetView = useCallback(() => {
    if (chartRef.current !== null) {
      let current = chartRef.current as any
      current.resetZoom()
    }
  }, [])


  let data: any = {labels: [props.data.name], datasets: []}

  function make_pointlist(xvect: number[], yvect: number[], scaling_x: number, scaling_y: number) {
    return xvect.map((x, idx) => ({x: scaling_x * x, y: scaling_y * yvect[idx]}))
  }

  const downloadData = useCallback(() => {
    let magdat = props.data.magnitude
    let phasedat = props.data.phase
    let delaydat = props.data.groupdelay

    const table = props.data.f.map((f, i) => {
      let mag: number | null = null
      if (magdat !== undefined)
        mag = magdat[i]
      let phase: number | null = null
      if (phasedat !== undefined)
        phase = phasedat[i]
      let delay: number | null = null
      if (delaydat !== undefined)
        delay = delaydat[i]
      return [f, mag, phase, delay]
    })
    let csvContent = "data:text/csv;charset=utf-8,frequency,magnitude,phase,groupdelay\n"
        + table.map(row => row.join(",")).join("\n")
    const link = document.createElement('a')
    link.download = props.data.name.replace(/\s/g, "_") + ".csv"
    link.href = encodeURI(csvContent)
    link.click()
  }, [props.data.f, props.data.magnitude, props.data.name, props.data.phase, props.data.groupdelay])

  const styles = cssStyles()
  const gainColor = styles.getPropertyValue('--gain-color')
  const phaseColor = styles.getPropertyValue('--phase-color')
  const impulseColor = styles.getPropertyValue('--impulse-color')
  const groupdelayColor = styles.getPropertyValue('--groupdelay-color')
  const magnitude = props.data.magnitude
  if (magnitude) {
    const gainpoints = make_pointlist(props.data.f, magnitude, 1.0, 1.0)
    data.datasets.push(
        {
          label: 'Gain',
          fill: false,
          borderColor: gainColor,
          backgroundColor: gainColor,
          pointBackgroundColor: gainColor,
          pointRadius: 0,
          showLine: true,
          data: gainpoints,
          yAxisID: "gain",
          xAxisID: "freq",
        }
    )
  }
  const phase = props.data.phase
  if (phase) {
    const phasepoints = make_pointlist(props.data.f, phase, 1.0, 1.0)
    data.datasets.push(
        {
          label: 'Phase',
          fill: false,
          borderColor: phaseColor,
          backgroundColor: phaseColor,
          pointRadius: 0,
          showLine: true,
          data: phasepoints,
          yAxisID: "phase",
          xAxisID: "freq",
        }
    )
  }
  const impulse = props.data.impulse
  if (impulse) {
    const impulsepoints = make_pointlist(props.data.time, impulse, 1000.0, 1.0)
    data.datasets.push(
        {
          label: 'Impulse',
          fill: false,
          borderColor: impulseColor,
          backgroundColor: impulseColor,
          pointRadius: 0,
          showLine: true,
          data: impulsepoints,
          yAxisID: "ampl",
          xAxisID: "time",
        }
    )
  }
  const groupdelay = props.data.groupdelay
  const f_groupdelay = props.data.f_groupdelay
  if (groupdelay && f_groupdelay) {
    const groupdelaypoints = make_pointlist(f_groupdelay, groupdelay, 1.0, 1.0)
    data.datasets.push(
        {
          label: 'Group delay',
          fill: false,
          borderColor: groupdelayColor,
          backgroundColor: groupdelayColor,
          pointRadius: 0,
          showLine: true,
          data: groupdelaypoints,
          yAxisID: "delay",
          xAxisID: "freq",
        }
    )
  }

  // Workaround to prevent the chart from resetting the zoom on every update.
  const options = useMemo(() => {

    const styles = cssStyles()
    const axesColor = styles.getPropertyValue('--axes-color')
    const textColor = styles.getPropertyValue('--text-color')
    const gainColor = styles.getPropertyValue('--gain-color')
    const phaseColor = styles.getPropertyValue('--phase-color')
    const impulseColor = styles.getPropertyValue('--impulse-color')
    const groupdelayColor = styles.getPropertyValue('--groupdelay-color')

    const zoomOptions = {
      zoom: {
        wheel: {
          enabled: true,
        },
        pinch: {
          enabled: true,
        },
        drag: {
          enabled: false,
        },
        mode: 'xy',
        overScaleMode: 'xy',
      },
      pan: {
        enabled: true,
        mode: 'xy',
        threshold: 3,
        overScaleMode: 'xy',
      }
    }

    const scales = {
      'freq': {
        type: 'logarithmic',
        position: 'bottom',
        title: {
          display: true,
          text: 'Frequency, Hz',
          color: textColor
        },
        grid: {
          zeroLineColor: axesColor,
          color: axesColor
        },
        ticks: {
          min: 0,
          max: 30000,
          maxRotation: 0,
          minRotation: 0,
          color: textColor,
          callback(tickValue: number, index: number, values: any) {
            if (tickValue === 0) {
              return '0'
            }
            let value = -1
            const range = values[values.length - 1].value / values[0].value
            const rounded = Math.pow(10, Math.floor(Math.log10(tickValue)))
            const first_digit = tickValue / rounded
            const rest = tickValue % rounded
            if (range > 10) {
              if (first_digit === 1 || first_digit === 2 || first_digit === 5) {
                value = tickValue
              }
            } else if (rest === 0) {
              value = tickValue
            }
            if (value >= 1000000) {
              return (value / 1000000).toString() + "M"
            } else if (value >= 1000) {
              return (value / 1000).toString() + "k"
            } else if (value > 0) {
              return value.toString()
            }
            return ''
          }
        },
        beforeUpdate: function (scale: any) {
          scale.options.display = scale.chart._metasets.some((e: any) => (e.xAxisID === scale.id && !e.hidden))
          return
        },
      },
      'time': {
        type: 'linear',
        position: 'top',
        title: {
          display: true,
          text: 'Time, ms',
          color: textColor
        },
        ticks: {
          color: textColor,
        },
        grid: {display: false},
        beforeUpdate: function (scale: any) {
          scale.options.display = scale.chart._metasets.some((e: any) => (e.xAxisID === scale.id && !e.hidden))
          return
        },
      },
      'gain': {
        type: 'linear',
        position: 'left',
        ticks: {
          color: gainColor,
        },
        title: {
          display: true,
          text: 'Gain, dB',
          color: gainColor
        },
        grid: {
          zeroLineColor: axesColor,
          color: axesColor,
          borderDash: [7, 3],
        },
        suggestedMin: -1,
        suggestedMax: 1,
        afterBuildTicks: function (scale: any) {
          let step = 1
          let range = scale.max - scale.min
          if (range > 150) {
            step = 50
          } else if (range > 60) {
            step = 20
          } else if (range > 30) {
            step = 10
          } else if (range > 20) {
            step = 5
          } else if (range > 10) {
            step = 2
          }
          let tick = Math.ceil(scale.min / step) * step
          const ticks = []
          while (tick <= scale.max) {
            ticks.push({"value": tick})
            tick += step
          }
          scale.ticks = ticks
        },
        beforeUpdate: function (scale: any) {
          scale.options.display = scale.chart._metasets.some((e: any) => (e.yAxisID === scale.id && !e.hidden))
          return
        },
      },
      'phase': {
        type: 'linear',
        position: 'right',
        min: -180,
        max: 180,
        afterBuildTicks: function (scale: any) {
          let step = 1
          let range = scale.max - scale.min
          if (range > 180) {
            step = 45
          } else if (range > 45) {
            step = 15
          } else if (range > 15) {
            step = 5
          }
          let tick = Math.ceil(scale.min / step) * step
          const ticks = []
          while (tick <= scale.max) {
            ticks.push({"value": tick})
            tick += step
          }
          scale.ticks = ticks
        },
        beforeUpdate: function (scale: any) {
          scale.options.display = scale.chart._metasets.some((e: any) => (e.yAxisID === scale.id && !e.hidden))
          return
        },
        ticks: {
          color: phaseColor,
        },
        title: {
          display: true,
          text: 'Phase, deg',
          color: phaseColor
        },
        grid: {
          display: true,
          zeroLineColor: axesColor,
          color: axesColor,
          borderDash: [3, 7],
        }
      },
      'ampl': {
        type: 'linear',
        position: 'right',
        ticks: {
          color: impulseColor
        },
        title: {
          display: true,
          text: 'Amplitude',
          color: impulseColor
        },
        grid: {display: false},
        beforeUpdate: function (scale: any) {
          scale.options.display = scale.chart._metasets.some((e: any) => (e.yAxisID === scale.id && !e.hidden))
          return
        },
      },
      'delay': {
        type: 'linear',
        position: 'right',
        suggestedMin: -0.001,
        suggestedMax: 0.001,
        ticks: {
          color: groupdelayColor
        },
        title: {
          display: true,
          text: 'Group delay, ms',
          color: groupdelayColor
        },
        grid: {
          display: true,
          zeroLineColor: axesColor,
          color: axesColor,
          borderDash: [1, 4],
        },
        beforeUpdate: function (scale: any) {
          scale.options.display = scale.chart._metasets.some((e: any) => (e.yAxisID === scale.id && !e.hidden))
          return
        },
      }
    }
    const options: { [key: string]: any } = {
      scales: scales,
      plugins: {
        zoom: zoomOptions,
        legend: {
          labels: {
            color: textColor,
          }
        },
      },
      animation: {
        duration: 500
      }
    }
    return options
  }, [])

  function sortBySamplerateAndChannels(a: FilterOption, b: FilterOption) {
    if (a.samplerate !== b.samplerate && a.samplerate !== undefined && b.samplerate !== undefined)
      return a.samplerate - b.samplerate
    if (a.channels !== b.channels && a.channels !== undefined && b.channels !== undefined)
      return a.channels - b.channels
    return 0
  }

  const sampleRateOptions = props.data.options.sort(sortBySamplerateAndChannels)
      .map(option =>
          <option key={option.name}>{option.name}</option>
      )
  const selected = props.data.options.find(option =>
      (option.samplerate === undefined || option.samplerate === props.data.samplerate)
      && (option.channels === undefined || option.channels === props.data.channels)
  )?.name
  return <>
    <div style={{textAlign: 'center'}}>
      {props.data.options.length > 0 && <select
        value={selected}
        data-tip="Select filter file"
        onChange={e => props.onChange(e.target.value)}
      >
        {sampleRateOptions}
      </select>}
    </div>
    <Scatter data={data} options={options} ref={chartRef}/>
    <MdiButton
        icon={mdiImage}
        tooltip="Save plot as image"
        onClick={downloadPlot}/>
    <MdiButton
        icon={mdiTable}
        tooltip="Save plot data as csv"
        onClick={downloadData}/>
    <MdiButton
        icon={mdiHome}
        tooltip="Reset zoom and pan"
        onClick={resetView}/>
    <ReactTooltip/>
  </>
}