import React, {ChangeEvent, CSSProperties, ReactNode} from "react"
import Icon from "@mdi/react"
import Popup from "reactjs-popup"
import {Scatter} from "react-chartjs-2"
import {mdiChartBellCurveCumulative, mdiDelete, mdiPlusThick} from "@mdi/js";
import {FLASKURL} from "./index";
import 'reactjs-popup/dist/index.css';

export interface Update<T> {
    (value: T): void
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
        formData.append("file"+index, file, file.name)
    }
    event.target.value = '' // this resets the upload field, so the same file can be uploaded twice in a row
    try {
        await fetch(`${FLASKURL}/api/upload${type}s`, {
            method: "POST",
            body: formData
        })
        onSuccess(uploadedFiles)
    } catch (e) {
        onError(e.message)
    }
}


export function Box(props: {
    title: string | ReactNode,
    children: ReactNode
}) {
    return (
        <fieldset className="box">
            <legend>{props.title}</legend>
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
    const {tooltip, checked, onChange, style} = props
    return <label data-tip={tooltip} className='checkbox-area' style={style}>
        <input
            type="checkbox"
            data-tip={tooltip}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}/>
    </label>
}

export function AddButton(props: {
    tooltip: string
    onClick: () => void
}) {
    return <MdiButton
        icon={mdiPlusThick}
        className="success"
        tooltip={props.tooltip}
        onClick={props.onClick}/>
}

export function DeleteButton(props: {
    tooltip: string
    onClick: () => void
    smallButton?: boolean
}) {
    return <MdiButton
        className="error"
        smallButton={props.smallButton}
        icon={mdiDelete}
        tooltip={props.tooltip}
        onClick={props.onClick}/>
}

export function PlotButton(props: {
    tooltip: string
    onClick: () => void
}) {
    return <MdiButton
        icon={mdiChartBellCurveCumulative}
        tooltip={props.tooltip}
        onClick={props.onClick}/>
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
    const style = Object.assign({verticalAlign: 'bottom'}, props.style)
    return (
        <label data-tip={props.tooltip}>
            <input style={{display: 'none'}} type="file" onChange={props.onChange} multiple={props.multiple}/>
            <MdiButton
                smallButton={props.smallButton}
                icon={props.icon}
                tooltip={props.tooltip}
                className={props.className}
                style={style}/>
        </label>
    )
}

export function MdiButton(props: {
    icon: string
    tooltip: string
    className?: string
    style?: CSSProperties
    enabled?: boolean
    smallButton?: boolean
    onClick?: () => void
}) {
    const { icon, tooltip, className, enabled, onClick, smallButton } = props
    const clickhandler = onClick === undefined || enabled === false ? () => {} : onClick
    let buttonClass = enabled !== false ? 'button' : 'disabled-button'
    if (smallButton === true) buttonClass += ' smallbutton'
    if (className !== undefined) buttonClass += ' ' + className
    const style = Object.assign({display: 'inline-block'},props.style)
    return <div onClick={clickhandler} data-tip={tooltip} className={buttonClass} style={style}>
        <Icon path={icon} size={'24px'}/>
    </div>
}

export function OptionLine(props: {
    desc: string
    'data-tip': string
    children: ReactNode
}) {
    return <label className="setting" data-tip={props['data-tip']}>
        <span className="setting-label">{props.desc}</span>
        {props.children}
    </label>
}

export function IntOption(props:{
    value: number
    desc: string
    'data-tip': string
    onChange: (value: number) => void
    withControls?: boolean
    min?: number
}) {
    return <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
        <IntInput {...props} className="setting-input" />
    </OptionLine>
}

export function IntInput(props: {
    value: number
    'data-tip': string
    onChange: (value: number) => void
    withControls?: boolean
    min?: number
    className?: string
    style?: CSSProperties
}) {
    return <ParsedInput
        {...props}
        asString={(int: number) => int.toString()}
        parseValue={(rawValue: string) => {
            const parsedvalue = parseInt(rawValue)
            return isNaN(parsedvalue) ? undefined : parsedvalue
        }}
    />
}

export function FloatOption(props:{
    value: number
    desc: string
    'data-tip': string
    onChange: (value: number) => void
}) {
    return <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
        <ParsedInput
            className="setting-input"
            value={props.value}
            data-tip={props["data-tip"]}
            onChange={props.onChange}
            asString={(float: number) => float.toString()}
            parseValue={(rawValue: string) => {
                const parsedvalue = parseFloat(rawValue)
                return isNaN(parsedvalue) ? undefined : parsedvalue
            }}
        />
    </OptionLine>
}

export function FloatListOption(props: {
    value: number[]
    desc: string
    'data-tip': string
    onChange: (value: number[]) => void
}) {
    return <OptionLine desc={props.desc} data-tip={props['data-tip']}>
        <ParsedInput
            className="setting-input"
            value={props.value}
            data-tip={props['data-tip']}
            asString={(value: number[]) => value.join(", ")}
            parseValue={(rawValue: string) => {
                const parsedvalue = [];
                const values = rawValue.split(",");
                for (let value of values) {
                    const tempvalue = parseFloat(value);
                    if (isNaN(tempvalue))
                        return undefined;
                    parsedvalue.push(tempvalue);
                }
                return parsedvalue
            }}
            onChange={props.onChange}
        />
    </OptionLine>
}

type ParsedInputProps<TYPE> = {
    style?: CSSProperties
    className?: string
    value: TYPE
    'data-tip': string
    onChange: (value: TYPE) => void
    asString: (value: TYPE) => string
    parseValue: (rawValue: string) => TYPE | undefined
    withControls?: boolean
    min?: number
}

export class ParsedInput<TYPE> extends React.Component<ParsedInputProps<TYPE>, { rawValue: string }> {

    constructor(props: ParsedInputProps<TYPE>) {
        super(props)
        this.updateValue = this.updateValue.bind(this)
        this.state = { rawValue: props.asString(props.value) }
    }

    componentDidUpdate(prevProps: ParsedInputProps<TYPE>) {
        if (prevProps.value !== this.props.value)
            this.setState({rawValue: this.props.asString(this.props.value)})
    }

    private updateValue(rawValue: string) {
        this.setState({rawValue})
        const parsed = this.props.parseValue(rawValue)
        if (parsed !== undefined)
            this.props.onChange(parsed)
    }

    render() {
        let props = this.props;
        const parsedValue = props.parseValue(this.state.rawValue)
        let valid = parsedValue !== undefined
        return <input
            type={props.withControls ? "number" : "text"}
            min={props.min}
            value={this.state.rawValue}
            data-tip={props["data-tip"]}
            className={props.className}
            style={{backgroundColor: valid ? "#FFFFFF" : "#FFAAAA", ...props.style}}
            onChange={(e) => this.updateValue(e.target.value)}/>
    }

}

export function BoolOption(props: {
    value: boolean,
    desc: string,
    'data-tip': string
    onChange: (value: boolean) => void
}) {
    return <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
        <div className="setting-input"
             data-tip={props["data-tip"]}
             style={{cursor: 'pointer'}}>
            <input
                style={{marginLeft: 0, marginTop: '8px', marginBottom: '8px'}}
                type="checkbox"
                checked={props.value}
                data-tip={props["data-tip"]}
                onChange={(e) => props.onChange(e.target.checked)}/>
        </div>
    </OptionLine>
}

export function EnumOption<OPTION extends string>(props: {
    value: OPTION
    options: OPTION[]
    desc: string
    'data-tip': string
    valueIsInvalid?: boolean
    onChange: (value: OPTION) => void
}) {
    return <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
        <EnumInput {...props} className="setting-input"/>
    </OptionLine>
}

export function EnumInput<OPTION extends string>(props: {
    value: OPTION
    options: OPTION[]
    desc: string
    'data-tip': string
    valueIsInvalid?: boolean
    style?: CSSProperties
    className?: string
    onChange: (value: OPTION) => void
}) {
    let className = props.className
    if (props.valueIsInvalid) className += ' error'
    return <select
        id={props.desc}
        name={props.desc}
        value={props.value}
        data-tip={props["data-tip"]}
        onChange={e => props.onChange(e.target.value as OPTION)}
        style={props.style}
        className={className}>
        {props.options.map((option) =>
            props.valueIsInvalid && option === props.value ?
                <option key={option} value={option} className={'error'}>{option}</option>
                : <option key={option} value={option} style={{color: 'initial'}}>{option}</option>
        )}
    </select>
}

export function TextOption(props: {
    value: string,
    desc: string,
    'data-tip': string
    onChange: (value: string) => void
}) {
    return <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
        <TextInput
            className="setting-input"
            value={props.value}
            data-tip={props["data-tip"]}
            onChange={props.onChange}/>
    </OptionLine>
}

export function TextInput(props: {
    value: string,
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
        onChange={e => props.onChange(e.target.value)}/>
}

export function ChartPopup(props: {
    open: boolean,
    data: any,
    onClose: () => void
}){
    function make_pointlist(xvect: number[], yvect: number[], scaling_x: number, scaling_y: number) {
        return xvect.map((x, idx) => ({x: scaling_x * x, y: scaling_y * yvect[idx]}))
    }

    let stateData = props.data;
    const name: string = stateData.hasOwnProperty("name") ? stateData["name"] : ""
    let data: any = {labels: [name], datasets: []}
    let x_time = false
    let x_freq = false
    let y_phase = false
    let y_gain = false
    let y_ampl = false

    if (stateData.hasOwnProperty("magnitude")) {
        const gainpoints = make_pointlist(stateData["f"], stateData["magnitude"], 1.0, 1.0)
        x_freq = true
        y_gain = true
        data.datasets.push(
            {
                label: 'Gain',
                fill: false,
                borderColor: 'rgba(0,0,220,1)',
                pointRadius: 0,
                showLine: true,
                data: gainpoints,
                yAxisID: "gain",
                xAxisID: "freq",
            }
        )
    }

    if (stateData.hasOwnProperty("phase")) {
        const phasepoints = make_pointlist(stateData["f"], stateData["phase"], 1.0, 1.0)
        x_freq = true
        y_phase = true
        data.datasets.push(
            {
                label: 'Phase',
                fill: false,
                borderColor: 'rgba(0,220,0,1)',
                pointRadius: 0,
                showLine: true,
                data: phasepoints,
                yAxisID: "phase",
                xAxisID: "freq",
            }
        )
    }

    if (stateData.hasOwnProperty("impulse")) {
        const impulsepoints = make_pointlist(stateData["time"], stateData["impulse"], 1000.0, 1.0)
        x_time = true
        y_ampl = true
        data.datasets.push(
            {
                label: 'Impulse',
                fill: false,
                borderColor: 'rgba(220,0,0,1)',
                pointRadius: 0,
                showLine: true,
                data: impulsepoints,
                yAxisID: "ampl",
                xAxisID: "time",
            }
        )
    }

    const options: { scales: { xAxes: any, yAxes: any } } = {
        scales: {
            xAxes: [],
            yAxes: []
        }
    }

    if (x_freq) {
        options.scales.xAxes.push(
            {
                id: "freq",
                type: 'logarithmic',
                position: 'bottom',
                scaleLabel: {
                    display: true,
                    labelString: 'Frequency, Hz'
                },
                ticks: {
                    min: 0,
                    max: 30000,
                    maxRotation: 50
                },
                afterBuildTicks: function (chartObj: any) {
                    chartObj.ticks = [
                        10, 20, 30, 40, 50,70,
                        100, 200, 300, 400, 500, 700,
                        1000, 2000, 3000, 4000, 5000, 7000,
                        10000, 20000
                    ];
                }
            }
        )
    }
    if (x_time) {
        options.scales.xAxes.push(
            {
                id: "time",
                type: 'linear',
                position: 'top',
                scaleLabel: {
                    display: true,
                    labelString: 'Time, ms'
                }
            }
        )
    }
    if (y_gain) {
        options.scales.yAxes.push(
            {
                id: "gain",
                type: 'linear',
                position: 'left',
                ticks: {
                    fontColor: 'rgba(0,0,220,1)'
                },
                scaleLabel: {
                    display: true,
                    labelString: 'Gain, dB',
                    fontColor: 'rgba(0,0,220,1)'
                }
            },
        )
    }
    if (y_phase) {
        options.scales.yAxes.push(
            {
                id: "phase",
                type: 'linear',
                position: 'right',
                ticks: {
                    fontColor: 'rgba(0,220,0,1)',
                    suggestedMin: -180,
                    suggestedMax: 180
                },
                scaleLabel: {
                    display: true,
                    labelString: 'Phase, deg',
                    fontColor: 'rgba(0,220,0,1)'
                }
            },
        )
    }
    if (y_ampl) {
        options.scales.yAxes.push(
            {
                id: "ampl",
                type: 'linear',
                position: 'right',
                ticks: {
                    fontColor: 'rgba(220,0,0,1)'
                },
                scaleLabel: {
                    display: true,
                    labelString: 'Amplitude',
                    fontColor: 'rgba(220,0,0,1)'
                }
            }
        )
    }

    return <Popup open={props.open} onClose={props.onClose}>
        <div className="modal">
            <span className="close" onClick={props.onClose}>✖</span>
            <div>
                <Scatter data={data} options={options}/>
            </div>
        </div>
    </Popup>
}