import React, { ChangeEvent, CSSProperties, ReactNode, useState } from "react"
import Icon from "@mdi/react"
import Popup from "reactjs-popup"
import { Scatter } from "react-chartjs-2"
import {
    Chart as ChartJS,
    LinearScale,
    LogarithmicScale,
    PointElement,
    LineElement,
    Tooltip,
    Legend,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { mdiChartBellCurveCumulative, mdiDelete, mdiPlusThick } from "@mdi/js"
import 'reactjs-popup/dist/index.css'
import { toMap } from "./arrays"

ChartJS.register(LinearScale, LogarithmicScale, PointElement, LineElement, Tooltip, Legend, zoomPlugin);

export function cssStyles(): CSSStyleDeclaration {
    return getComputedStyle(document.body)
}

export function download(filename: string, blob: any) {
    let a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.hidden = true
    document.body.appendChild(a)
    a.innerHTML = "abcdefg"
    a.click()
}

export async function doUpload(
    type: 'config' | 'coeff',
    event: ChangeEvent<HTMLInputElement>,
    onSuccess: (filesnames: string[]) => void,
    onError: (message: string) => void
) {
    const formData = new FormData()
    const files = event.target.files as FileList
    const uploadedFiles: string[] = []
    for (let index = 0; index < files.length; index++) {
        const file = files[index]
        uploadedFiles.push(file.name)
        formData.append("file" + index, file, file.name)
    }
    event.target.value = '' // this resets the upload field, so the same file can be uploaded twice in a row
    try {
        await fetch(`/api/upload${type}s`, {
            method: "POST",
            body: formData
        })
        onSuccess(uploadedFiles)
    } catch (e: any) {
        onError(e.message)
    }
}


export function Box(props: {
    title: string | ReactNode
    style?: CSSProperties
    children: ReactNode
}) {
    return (
        <fieldset className="box" style={props.style}>
            <legend>
                <div className="horizontally-spaced-content" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                    {props.title}
                </div>
            </legend>
            {props.children}
        </fieldset>
    )
}

export function CheckBox(props: {
    tooltip: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
    style?: CSSProperties
}) {
    const { tooltip, checked, onChange, style } = props
    return <label data-tip={tooltip} className='checkbox-area' style={style}>
        <input
            type="checkbox"
            data-tip={tooltip}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)} />
    </label>
}

export function Button(props: {
    text: string
    "data-tip"?: string
    onClick: () => void
    style?: CSSProperties
    className?: string
    enabled?: boolean
}) {
    const enabled = props.enabled || props.enabled === undefined
    const disabledStyle = enabled ? "" : "disabled-button"
    const additionalClasses = props.className || ""
    return <div
        data-tip={props["data-tip"]}
        className={`button button-with-text ${disabledStyle} ${additionalClasses}`}
        style={props.style}
        onClick={enabled ? props.onClick : () => { }}>
        {props.text}
    </div>
}

export function SuccessFailureButton(props: {
    text: string
    "data-tip"?: string
    onClick: () => Promise<void>
    style?: CSSProperties
    enabled?: boolean
}) {
    const [timer] = useState(() => delayedExecutor(1000))
    const [success, setSuccess] = useState<boolean | undefined>(undefined)
    let className = ''
    if (success === true)
        className = 'success-text'
    if (success === false)
        className = 'error-text'
    function setSuccessAndtimer(success: boolean) {
        setSuccess(success)
        timer(() => setSuccess(undefined))
    }
    const onClick = () => props.onClick().then(
        () => setSuccessAndtimer(true),
        () => setSuccessAndtimer(false)
    )
    return <Button {...props} className={className} onClick={onClick} />
}

export function AddButton(props: {
    tooltip: string
    style?: CSSProperties
    onClick: () => void
}) {
    const style = Object.assign({ color: 'var(--button-add-icon-color)' }, props.style)
    return <MdiButton
        icon={mdiPlusThick}
        style={style}
        tooltip={props.tooltip}
        onClick={props.onClick} />
}

export function DeleteButton(props: {
    tooltip: string
    onClick: () => void
    smallButton?: boolean
}) {
    return <MdiButton
        style={{ color: 'var(--button-remove-icon-color)' }}
        buttonSize={props.smallButton ? "small" : "default"}
        icon={mdiDelete}
        tooltip={props.tooltip}
        onClick={props.onClick} />
}

export function PlotButton(props: {
    tooltip: string
    onClick: () => void
}) {
    return <MdiButton
        icon={mdiChartBellCurveCumulative}
        tooltip={props.tooltip}
        onClick={props.onClick} />
}

export function UploadButton(props: {
    icon: string
    tooltip: string
    onChange: (event: ChangeEvent<HTMLInputElement>) => void
    multiple?: boolean
    className?: string
    style?: CSSProperties
    smallButton?: boolean
}): JSX.Element {
    const style = Object.assign({ verticalAlign: 'bottom' }, props.style)
    return (
        <label data-tip={props.tooltip}>
            <input style={{ display: 'none' }} type="file" onChange={props.onChange} multiple={props.multiple} />
            <MdiButton
                buttonSize={props.smallButton ? "small" : "default"}
                icon={props.icon}
                tooltip={props.tooltip}
                className={props.className}
                style={style} />
        </label>
    )
}

export function MdiButton(props: {
    icon: string
    tooltip: string
    className?: string
    style?: CSSProperties
    enabled?: boolean
    buttonSize?: "default" | "small" | "tiny"
    onClick?: () => void
}) {
    const { icon, tooltip, className, enabled, onClick, buttonSize } = props
    const clickhandler = onClick === undefined || enabled === false ? () => { } : onClick
    let buttonClass = 'button button-with-icon'
    if (enabled === false) buttonClass += ' disabled-button'
    if (buttonSize === "small") buttonClass += ' smallbutton'
    else if (buttonSize === "tiny") buttonClass += ' tinybutton'
    if (className !== undefined) buttonClass += ' ' + className
    return <div onClick={clickhandler} data-tip={tooltip} className={buttonClass} style={props.style}>
        <Icon path={icon} size={buttonSize === "tiny" ? '15px' : '24px'} />
    </div>
}

export function MdiIcon(props: {
    icon: string
    tooltip: string
    style?: CSSProperties
}) {
    return <span data-tip={props.tooltip} style={props.style}>
        <Icon path={props.icon} size={'15px'} />
    </span>
}

export function CloseButton(props: {
    onClick: () => void
}) {
    return <div style={{ textAlign: 'right', cursor: 'pointer' }} onClick={props.onClick}>✖</div>
}

export function OptionLine(props: {
    desc: string
    'data-tip': string
    children: ReactNode
    small?: boolean
}) {
    const settingStyle = props.small ? { width: 'min-content' } : {}
    return <label className="setting" data-tip={props['data-tip']} style={settingStyle}>
        <span className="setting-label">{props.desc}</span>
        {props.children}
    </label>
}

export function IntOption(props: {
    value: number
    error?: string
    desc: string
    'data-tip': string
    onChange: (value: number) => void
    small?: boolean
    withControls?: boolean
    min?: number
    max?: number
}) {
    const small = props.small
    return <>
        <OptionLine desc={props.desc} data-tip={props["data-tip"]} small={small}>
            <IntInput
                {...props}
                className={'setting-input' + (small ? ' small-setting-input' : '')}
                style={props.error ? ERROR_BACKGROUND_STYLE : undefined} />
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}

export function IntInput(props: {
    value: number
    'data-tip': string
    onChange: (value: number) => void
    withControls?: boolean
    min?: number
    max?: number
    className?: string
    style?: CSSProperties
}) {
    const { min, max } = props
    return <ParsedInput
        {...props}
        immediate={true} 
        asString={(int: number) => int.toString()}
        parseValue={(rawValue: string) => {
            const parsedvalue = parseInt(rawValue)
            if (isNaN(parsedvalue)
                || (min !== undefined && parsedvalue < min)
                || (max !== undefined && parsedvalue > max))
                return undefined
            else
                return parsedvalue
        }}
    />
}

export function FloatOption(props: {
    value: number
    error?: string
    desc: string
    'data-tip': string
    onChange: (value: number) => void
}) {
    return <>
        <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
            <FloatInput
                value={props.value}
                data-tip={props["data-tip"]}
                onChange={props.onChange}
                className="setting-input" />
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}

export function FloatInput(props: {
    value: number
    error?: boolean
    'data-tip': string
    onChange: (value: number) => void
    className?: string
    style?: CSSProperties
}) {
    return <ParsedInput
        value={props.value}
        immediate={true}
        data-tip={props["data-tip"]}
        onChange={props.onChange}
        asString={(float?: number) => float === undefined ? "" : float.toString()}
        parseValue={(rawValue: string) => {
            const parsedvalue = parseFloat(rawValue)
            return isNaN(parsedvalue) || rawValue.endsWith(".") ? undefined : parsedvalue
        }}
        className={props.className}
        style={{ ...props.style, ...(props.error ? ERROR_BACKGROUND_STYLE : undefined) }}
    />
}

export function FloatListOption(props: {
    value: number[]
    error?: string
    desc: string
    'data-tip': string
    onChange: (value: number[]) => void
}) {
    return <>
        <OptionLine desc={props.desc} data-tip={props['data-tip']}>
            <ParsedInput
                className="setting-input"
                immediate={true}
                value={props.value}
                data-tip={props['data-tip']}
                asString={(value: number[]) => value.join(", ")}
                parseValue={(rawValue: string) => {
                    const parsedvalue = []
                    const values = rawValue.split(",")
                    for (let value of values) {
                        const tempvalue = parseFloat(value)
                        if (isNaN(tempvalue))
                            return undefined
                        parsedvalue.push(tempvalue)
                    }
                    return parsedvalue
                }}
                onChange={props.onChange}
                style={props.error ? ERROR_BACKGROUND_STYLE : undefined}
            />
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}

type ParsedInputProps<TYPE> = {
    style?: CSSProperties
    className?: string
    value: TYPE
    'data-tip': string
    onChange: (value: TYPE) => void
    asString: (value: TYPE) => string
    parseValue: (rawValue: string) => TYPE | undefined
    immediate: boolean
    withControls?: boolean
    min?: number
    max?: number
}

export class ParsedInput<TYPE> extends React.Component<ParsedInputProps<TYPE>, { rawValue: string, pending: boolean }> {

    constructor(props: ParsedInputProps<TYPE>) {
        super(props)
        this.updateValue = this.updateValue.bind(this)
        this.state = { rawValue: props.asString(props.value), pending: false }
    }

    componentDidUpdate(prevProps: ParsedInputProps<TYPE>) {
        if (prevProps.value !== this.props.value)
            this.setState({ rawValue: this.props.asString(this.props.value) })
    }

    private updateValue(rawValue: string, perform_callback: boolean) {
        this.setState({ rawValue: rawValue, pending: true })
        const parsed = this.props.parseValue(rawValue)
        if (parsed !== undefined && (perform_callback || this.props.immediate)) {
            this.props.onChange(parsed)
            this.setState({ pending: false })
        }
    }

    handleSubmit(event: any) {
        if (!this.props.immediate && event.key === 'Enter') {
            event.preventDefault();
            const parsed = this.props.parseValue(this.state.rawValue)
            if (parsed !== undefined) {
                this.props.onChange(parsed)
                this.setState({ pending: false })
            }
        }
    }

    private getStyle(valid: boolean): CSSProperties | undefined {
        const style = this.props.style
        const pending = this.state.pending
        if (!valid) { 
            return { ...style, ...ERROR_BACKGROUND_STYLE }
        }
        else if (pending) {
            return { ...style, ...PENDING_BACKGROUND_STYLE }
        }
        return style
    }

    render() {
        const props = this.props
        const parsedValue = props.parseValue(this.state.rawValue)
        const valid = parsedValue !== undefined
        return <input
            type={props.withControls ? "number" : "text"}
            min={props.min}
            max={props.max}
            value={this.state.rawValue}
            data-tip={props["data-tip"]}
            className={props.className}
            style={this.getStyle(valid)}
            onBlur={e => this.updateValue(e.target.value, true)}
            onChange={e => this.updateValue(e.target.value, false)}
            onKeyDown={e => this.handleSubmit(e)} />
    }

}



export const ERROR_BACKGROUND_STYLE: CSSProperties =
    Object.freeze({ backgroundColor: 'var(--error-field-background-color)' })

export const PENDING_BACKGROUND_STYLE: CSSProperties =
    Object.freeze({ backgroundColor: 'var(--pending-field-background-color)' })

export function ErrorMessage(props: { message?: string }) {
    return props.message ?
        <div style={{ color: 'var(--error-text-color)', whiteSpace: 'pre-wrap' }}>{props.message}</div>
        : null
}

export function BoolOption(props: {
    value: boolean
    error?: string
    desc: string
    'data-tip': string
    small?: boolean
    onChange: (value: boolean) => void
}) {
    const small = props.small
    return <>
        <OptionLine desc={props.desc} data-tip={props["data-tip"]} small={small}>
            <div className={"setting-input" + (small ? " small-setting-input" : "")}
                data-tip={props["data-tip"]}
                style={{ cursor: 'pointer' }}>
                <input
                    style={{ marginLeft: 0, marginTop: '8px', marginBottom: '8px' }}
                    type="checkbox"
                    checked={props.value}
                    data-tip={props["data-tip"]}
                    onChange={(e) => props.onChange(e.target.checked)} />
            </div>
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}

export function EnumOption<OPTION extends string>(props: {
    value: OPTION
    options: OPTION[]
    error?: string
    desc: string
    'data-tip': string
    className?: string
    onChange: (value: OPTION) => void
}) {
    const className = 'setting-input' + (props.className ? ' ' + props.className : '')
    return <>
        <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
            <EnumInput {...props} className={className} style={props.error ? ERROR_BACKGROUND_STYLE : undefined} />
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}


/*
 options - list of options OR object with value to display text mapping
 */
export function EnumInput<OPTION extends string>(props: {
    value: OPTION
    options: OPTION[] | { [key: string]: string }
    desc: string
    'data-tip': string
    style?: CSSProperties
    className?: string
    onChange: (value: OPTION) => void
}) {
    const { options, value } = props
    const optionsMap = Array.isArray(options) ? toMap(options) : options
    if (!Object.keys(optionsMap).includes(value))
        optionsMap[value] = value
    return <select
        id={props.desc}
        name={props.desc}
        value={value}
        data-tip={props["data-tip"]}
        onChange={e => props.onChange(e.target.value as OPTION)}
        style={props.style}
        className={props.className}
    >
        {Object.keys(optionsMap).map(key => <option key={key} value={key}>{optionsMap[key]}</option>)}
    </select>
}

export function TextOption(props: {
    value: string
    error?: string
    desc: string
    'data-tip': string
    onChange: (value: string) => void
}) {
    return <>
        <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
            <TextInput
                className="setting-input"
                value={props.value}
                data-tip={props["data-tip"]}
                style={props.error ? ERROR_BACKGROUND_STYLE : undefined}
                onChange={props.onChange} />
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}

export function TextInput(props: {
    value: string
    'data-tip': string
    className?: string
    style?: CSSProperties
    onChange: (value: string) => void
}) {
    return <input
        type="text"
        value={props.value}
        data-tip={props["data-tip"]}
        className={props.className}
        style={props.style}
        onChange={e => props.onChange(e.target.value)} />
}

interface Action {
    (): void
}

/**
 * Creates an executor, that executes the action after delay in ms,
 * if no other action is received during that time.
 */
export function delayedExecutor(delay: number): (action: Action) => void {
    let timerId: undefined | number
    return function (action: Action) {
        if (timerId)
            window.clearInterval(timerId)
        timerId = window.setTimeout(() => {
            timerId = undefined
            action()
        }, delay)
    }
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
}

export interface FilterOption {
    name: string
    channels?: number
    samplerate?: number
}

export function ChartPopup(props: {
    open: boolean
    data: ChartData
    onChange: (item: string) => void
    onClose: () => void
}) {
    return <Popup open={props.open} onClose={props.onClose}>
        <CloseButton onClick={props.onClose} />
        <h3 style={{ textAlign: 'center' }}>{props.data.name}</h3>
        <Chart onChange={props.onChange} data={props.data} />
    </Popup>
}

export function Chart(props: {
    data: ChartData
    onChange: (item: string) => void
}) {
    let data: any = { labels: [props.data.name], datasets: [] }
    function make_pointlist(xvect: number[], yvect: number[], scaling_x: number, scaling_y: number) {
        return xvect.map((x, idx) => ({ x: scaling_x * x, y: scaling_y * yvect[idx] }))
    }

    let x_time = false
    let x_freq = false
    let y_phase = false
    let y_gain = false
    let y_ampl = false

    const styles = cssStyles()
    const axesColor = styles.getPropertyValue('--axes-color')
    const textColor = styles.getPropertyValue('--text-color')
    const gainColor = styles.getPropertyValue('--gain-color')
    const phaseColor = styles.getPropertyValue('--phase-color')
    const impulseColor = styles.getPropertyValue('--impulse-color')
    const magnitude = props.data.magnitude
    if (magnitude) {
        const gainpoints = make_pointlist(props.data.f, magnitude, 1.0, 1.0)
        x_freq = true
        y_gain = true
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
        x_freq = true
        y_phase = true
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
        x_time = true
        y_ampl = true
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
    };

    const options: { [key: string]: any } = {
        scales: {},
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

    if (x_freq) {
        options.scales.freq = {
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
                        return '0';
                    }
                    let value = -1;
                    let range = values[values.length - 1].value / values[0].value;
                    const rounded = Math.pow(10, Math.floor(Math.log10(tickValue)));
                    const first_digit = tickValue / rounded;
                    const rest = tickValue % rounded;
                    if (range > 10) {
                        if (first_digit === 1 || first_digit === 2 || first_digit === 5) {
                            value = tickValue;
                        }
                    }
                    else if (rest === 0) {
                        value = tickValue;
                    }
                    if (value >= 1000000) {
                        return (value / 1000000).toString() + "M";
                    }
                    else if (value >= 1000) {
                        return (value / 1000).toString() + "k";
                    }
                    else if (value > 0) {
                        return value.toString()
                    }
                    return '';
                }
            },
            beforeUpdate: function (scale: any) {
                if (scale.chart._metasets.some(function (e: any) { return (e.xAxisID === scale.id && !e.hidden); })) {
                    scale.options.display = true
                }
                else {
                    scale.options.display = false
                }
                return;
            },
        }
    }
    if (x_time) {
        options.scales.time = {
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
            grid: { display: false },
            beforeUpdate: function (scale: any) {
                if (scale.chart._metasets.some(function (e: any) { return (e.xAxisID === scale.id && !e.hidden); })) {
                    scale.options.display = true
                }
                else {
                    scale.options.display = false
                }
                return;
            },
        }
    }
    if (y_gain) {
        options.scales.gain =
        {
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
            afterBuildTicks: function (scale: any) {
                var step = 1;
                let range = scale.max - scale.min;
                if (range > 150) {
                    step = 50
                }
                else if (range > 60) {
                    step = 20
                }
                else if (range > 30) {
                    step = 10
                }
                else if (range > 20) {
                    step = 5
                }
                else if (range > 10) {
                    step = 2
                }
                let tick = Math.ceil(scale.min / step) * step;
                var ticks = [];
                while (tick <= scale.max) {
                    ticks.push({ "value": tick });
                    tick += step;
                }
                scale.ticks = ticks
            },
            beforeUpdate: function (scale: any) {
                if (scale.chart._metasets.some(function (e: any) { return (e.yAxisID === scale.id && !e.hidden); })) {
                    scale.options.display = true
                }
                else {
                    scale.options.display = false
                }
                return;
            },
        }
    }
    if (y_phase) {
        options.scales.phase =
        {
            type: 'linear',
            position: 'right',
            min: -180,
            max: 180,
            afterBuildTicks: function (scale: any) {
                var step = 1;
                let range = scale.max - scale.min;
                if (range > 180) {
                    step = 45
                }
                else if (range > 45) {
                    step = 15
                }
                else if (range > 15) {
                    step = 5
                }
                let tick = Math.ceil(scale.min / step) * step;
                var ticks = [];
                while (tick <= scale.max) {
                    ticks.push({ "value": tick });
                    tick += step;
                }
                scale.ticks = ticks
            },
            beforeUpdate: function (scale: any) {
                if (scale.chart._metasets.some(function (e: any) { return (e.yAxisID === scale.id && !e.hidden); })) {
                    scale.options.display = true
                }
                else {
                    scale.options.display = false
                }
                return;
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
        }
    }
    if (y_ampl) {
        options.scales.ampl =
        {
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
            grid: { display: false },
            beforeUpdate: function (scale: any) {
                if (scale.chart._metasets.some(function (e: any) { return (e.yAxisID === scale.id && !e.hidden); })) {
                    scale.options.display = true
                }
                else {
                    scale.options.display = false
                }
                return;
            },
        }
    }
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
        <div style={{ textAlign: 'center' }}>
            {props.data.options.length > 0 && <select
                value={selected}
                data-tip="Select filter file"
                onChange={e => props.onChange(e.target.value)}
            >
                {sampleRateOptions}
            </select>}
        </div>
        <Scatter data={data} options={options} />
    </>
}

export function ListSelectPopup(props: {
    open: boolean
    header?: ReactNode
    items: string[]
    onSelect: (value: string) => void
    onClose: () => void
}) {
    const { open, items, onSelect, onClose } = props
    const selectItem = (item: string) => { onSelect(item); onClose() }
    return <Popup open={open} closeOnDocumentClick={true} onClose={onClose} contentStyle={{ width: 'max-content' }}>
        <CloseButton onClick={onClose} />
        {props.header}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            {items.map(item =>
                <Button
                    key={item}
                    text={item}
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => selectItem(item)} />
            )}
        </div>
    </Popup>
}