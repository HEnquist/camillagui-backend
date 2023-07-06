import React, { ChangeEvent, CSSProperties, ReactNode, useState, useRef, useCallback, useMemo } from "react"
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
import { mdiChartBellCurveCumulative, mdiDelete, mdiImage, mdiPlusThick, mdiTable, mdiSitemapOutline, mdiHome } from "@mdi/js"
import ReactTooltip from "react-tooltip"
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
    } catch (e) {
        onError(e.message)
    }
}


export function Box(props: {
    title: string | ReactNode
    style?: CSSProperties
    children: ReactNode
    tooltip?: string
}) {
    return (
        <fieldset className="box" style={props.style}>
            <legend>
                <div data-tip={props.tooltip} className="horizontally-spaced-content" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
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
    pipeline?: boolean
    onClick: () => void
}) {
    return <MdiButton
        icon={props.pipeline ? mdiSitemapOutline : mdiChartBellCurveCumulative}
        tooltip={props.tooltip}
        onClick={props.onClick}
        rotation={props.pipeline ? 270 : 0} />
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
    rotation?: number
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
    let rot = {}
    if (props.rotation && props.rotation !== 0)
        rot = { transform: "rotate(" + props.rotation + "deg)" }
    return <div onClick={clickhandler} data-tip={tooltip} className={buttonClass} style={props.style}>
        <Icon path={icon} size={buttonSize === "tiny" ? '15px' : '24px'} style={rot} />
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

export function OptionalIntOption(props: {
    value: number|null
    error?: string
    desc: string
    'data-tip': string
    onChange: (value: number | null) => void
    small?: boolean
    withControls?: boolean
    min?: number
    max?: number
}) {
    const small = props.small
    return <>
        <OptionLine desc={props.desc} data-tip={props["data-tip"]} small={small}>
            <OptionalIntInput
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

export function OptionalIntInput(props: {
    value: number | null
    'data-tip': string
    onChange: (value: number | null) => void
    withControls?: boolean
    min?: number
    max?: number
    className?: string
    style?: CSSProperties
}) {
    const { min, max } = props
    return <OptionalParsedInput
        {...props}
        immediate={true}
        asString={(int: number | null) => int !== null ? int.toString(): ""}
        parseValue={(rawValue: string | undefined) => {
            const parsedvalue = rawValue !== undefined ? parseInt(rawValue) : NaN 
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

export function OptionalFloatOption(props: {
    value: number|null
    error?: string
    desc: string
    'data-tip': string
    onChange: (value: number|null) => void
    placeholder?: string
}) {
    return <>
        <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
            <OptionalFloatInput
                value={props.value}
                data-tip={props["data-tip"]}
                onChange={props.onChange}
                placeholder={props.placeholder}
                className="setting-input" />
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}

export function OptionalFloatInput(props: {
    value: number|null
    error?: boolean
    'data-tip': string
    onChange: (value: number|null) => void
    className?: string
    style?: CSSProperties
    placeholder?: string
}) {
    return <OptionalParsedInput
        value={props.value}
        immediate={true}
        data-tip={props["data-tip"]}
        onChange={props.onChange}
        placeholder={props.placeholder}
        asString={(float?: number|null) => (float === undefined || float === null) ? "" : float.toString()}
        parseValue={(rawValue: string | undefined) => {
            if (rawValue === "")
                return null
            const parsedvalue = (rawValue !== undefined) ? parseFloat(rawValue) : NaN 
            if (isNaN(parsedvalue))
                return undefined
            else
                return parsedvalue
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
    placeholder?: string
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
        let style = this.props.style
        const pending = this.state.pending
        if (!valid) {
            style = { ...style, ...ERROR_BACKGROUND_STYLE }
        }
        if (pending) {
            style = { ...style, ...PENDING_BACKGROUND_STYLE }
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
            placeholder={props.placeholder}
            data-tip={props["data-tip"]}
            className={props.className}
            style={this.getStyle(valid)}
            onBlur={e => this.updateValue(e.target.value, true)}
            onChange={e => this.updateValue(e.target.value, false)}
            onKeyDown={e => this.handleSubmit(e)} />
    }

}

type OptionalParsedInputProps<TYPE> = {
    style?: CSSProperties
    className?: string
    value: TYPE | null
    'data-tip': string
    onChange: (value: TYPE | null) => void
    asString: (value: TYPE | null) => string | undefined
    parseValue: (rawValue: string | undefined) => TYPE | null | undefined
    immediate: boolean
    withControls?: boolean
    min?: number
    max?: number
    placeholder?: string
}

export class OptionalParsedInput<TYPE> extends React.Component<OptionalParsedInputProps<TYPE>, { rawValue: string | undefined, pending: boolean }> {

    constructor(props: OptionalParsedInputProps<TYPE>) {
        super(props)
        this.updateValue = this.updateValue.bind(this)
        this.state = { rawValue: props.asString(props.value), pending: false }
    }

    componentDidUpdate(prevProps: OptionalParsedInputProps<TYPE>) {
        if (prevProps.value !== this.props.value)
            this.setState({ rawValue: this.props.asString(this.props.value) })
    }

    private updateValue(rawValue: string, perform_callback: boolean) {
        this.setState({ rawValue: rawValue, pending: true })
        const parsed = rawValue === "" ? null : this.props.parseValue(rawValue)
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
        let style = this.props.style
        const pending = this.state.pending
        if (!valid) {
            style = { ...style, ...ERROR_BACKGROUND_STYLE }
        }
        if (pending) {
            style = { ...style, ...PENDING_BACKGROUND_STYLE }
        }
        return style
    }

    render() {
        const props = this.props
        const placeholder = this.props.placeholder ? this.props.placeholder : "default"
        let valid = true
        if (this.state.rawValue) {
            const parsedValue = props.parseValue(this.state.rawValue)
            valid = parsedValue !== undefined
        }
        return <input
            placeholder={placeholder}
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
    Object.freeze({ fontStyle: 'italic' })

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

export function OptionalBoolOption(props: {
    value: boolean|null
    error?: string
    desc: string
    'data-tip': string
    small?: boolean
    onChange: (value: boolean|null) => void
}) {
    const small = props.small
    return <>
        <OptionLine desc={props.desc} data-tip={props["data-tip"]} small={small}>
            <OptionalBoolInput {...props} className={"setting-input" + (small ? " small-setting-input" : "")} style={props.error ? ERROR_BACKGROUND_STYLE : undefined} />
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


export function add_default_option<OPTION extends string>(options: OPTION[], defaultValue: string): void {
    options.unshift(defaultValue as OPTION)
}

export function null_to_default<OPTION extends string>(value: OPTION|null, defaultValue: string): OPTION {
    if (value === null)
        return defaultValue as OPTION
    return value
}

export function default_to_null<OPTION extends string>(value: OPTION, defaultValue: string): OPTION|null {
    if (value === defaultValue)
        return null
    return value
}

export function OptionalEnumOption<OPTION extends string>(props: {
    value: OPTION|null
    options: OPTION[]
    error?: string
    desc: string
    'data-tip': string
    className?: string
    placeholder?: string
    onChange: (value: OPTION|null) => void
}) {
    const defaultValue = props.placeholder ? props.placeholder : "default"
    const className = 'setting-input' + (props.className ? ' ' + props.className : '')
    add_default_option(props.options, defaultValue)
    return <>
        <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
            <EnumInput
                value={null_to_default(props.value, defaultValue)}
                options={props.options}
                desc={props.desc}
                data-tip={props["data-tip"]}
                onChange={(e) => props.onChange(default_to_null(e, defaultValue))}
                className={className}
                style={props.error ? ERROR_BACKGROUND_STYLE : undefined} />
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
        className={value === "default" ? props.className+"-default": props.className}
    >
        {Object.keys(optionsMap).map(key => <option key={key} value={key}>{optionsMap[key]}</option>)}
    </select>
}

function string_to_bool(valuestr: string): boolean|null {
    switch(valuestr) {
        case "default":
            return null
        case "yes":
            return true
        case "no":
            return false
    }
    return null
}

function bool_to_string(value: boolean|null): string {
    switch(value) {
        case null:
            return "default"
        case true:
            return "yes"
        case false:
            return "no"
    }
}

export function OptionalBoolInput(props: {
    value: boolean|null
    desc: string
    'data-tip': string
    style?: CSSProperties
    className?: string
    onChange: (value: boolean|null) => void
}) {
    let valuestring = bool_to_string(props.value)

    return <select
        id={props.desc}
        name={props.desc}
        value={valuestring}
        data-tip={props["data-tip"]}
        onChange={e => props.onChange(string_to_bool(e.target.value))}
        style={props.style}
        className={valuestring === "default" ? props.className+"-default": props.className}
    >
        <option key="default">default</option>
        <option key="yes">yes</option>
        <option key="no">no</option>
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

export function OptionalTextOption(props: {
    value: string|null
    error?: string
    desc: string
    'data-tip': string
    onChange: (value: string|null) => void
    placeholder?: string
}) {
    return <>
        <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
            <OptionalTextInput
                placeholder={props.placeholder === undefined ? "default" : props.placeholder}
                className="setting-input"
                value={props.value}
                data-tip={props["data-tip"]}
                style={props.error ? ERROR_BACKGROUND_STYLE : undefined}
                onChange={props.onChange} 
                />
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}

export function OptionalTextInput(props: {
    value: string|null
    'data-tip': string
    className?: string
    style?: CSSProperties
    onChange: (value: string|null) => void
    placeholder?: string
}) {
    return <input
        placeholder={props.placeholder}
        type="text"
        value={props.value === null ? "": props.value}
        data-tip={props["data-tip"]}
        className={props.className}
        style={props.style}
        onChange={e => e.target.value === "" ? props.onChange(null) : props.onChange(e.target.value)} />
}

export function TextInput(props: {
    value: string
    'data-tip': string
    className?: string
    style?: CSSProperties
    onChange: (value: string) => void
    placeholder?: string
}) {
    return <input
        placeholder={props.placeholder}
        type="text"
        value={props.value}
        data-tip={props["data-tip"]}
        className={props.className}
        style={props.style}
        onChange={e => props.onChange(e.target.value)} />
}

export function MultilineTextInput(props: {
    value: string
    'data-tip': string
    className?: string
    style?: CSSProperties
    onChange: (value: string) => void
    placeholder?: string
    rows: number
}) {
    return <textarea
        placeholder={props.placeholder}
        rows={props.rows}
        value={props.value}
        data-tip={props["data-tip"]}
        className={props.className}
        style={props.style}
        onChange={e => props.onChange(e.target.value)}></textarea>
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
    groupdelay?: number[]
    f_groupdelay?: number[]
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
    const chartRef = useRef(null);
    const downloadPlot = useCallback(() => {
        const link = document.createElement('a');
        link.download = props.data.name.replace(/\s/g, "_") + ".png"

        if (chartRef.current !== null) {
            let current = chartRef.current as any
            link.href = current.toBase64Image();
            link.click();
        }
    }, [props.data.name])

    const resetView = useCallback(() => {
        if (chartRef.current !== null) {
            let current = chartRef.current as any
            current.resetZoom();
        }
    }, [])



    let data: any = { labels: [props.data.name], datasets: [] }
    function make_pointlist(xvect: number[], yvect: number[], scaling_x: number, scaling_y: number) {
        return xvect.map((x, idx) => ({ x: scaling_x * x, y: scaling_y * yvect[idx] }))
    }

    const downloadData = useCallback(() => {
        let magdat = props.data.magnitude
        let phasedat = props.data.phase
        let delaydat = props.data.groupdelay

        var table = props.data.f.map(function (f, i) {
            let mag: number | null = null
            if (magdat !== undefined)
                mag = magdat[i]
            let phase: number | null = null
            if (phasedat !== undefined)
                phase = phasedat[i]
            let delay: number | null = null
            if (delaydat !== undefined)
                delay = delaydat[i]
            return [f, mag, phase, delay];
        });
        let csvContent = "data:text/csv;charset=utf-8,frequency,magnitude,phase,groupdelay\n"
            + table.map(row => row.join(",")).join("\n")
        const link = document.createElement('a')
        link.download = props.data.name.replace(/\s/g, "_") + ".csv"
        link.href = encodeURI(csvContent);
        link.click();
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
        };
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
            },
            'phase': {
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
        <div style={{ textAlign: 'center' }}>
            {props.data.options.length > 0 && <select
                value={selected}
                data-tip="Select filter file"
                onChange={e => props.onChange(e.target.value)}
            >
                {sampleRateOptions}
            </select>}
        </div>
        <Scatter data={data} options={options} ref={chartRef} />
        <MdiButton
            icon={mdiImage}
            tooltip="Save plot as image"
            onClick={downloadPlot} />
        <MdiButton
            icon={mdiTable}
            tooltip="Save plot data as csv"
            onClick={downloadData} />
        <MdiButton
            icon={mdiHome}
            tooltip="Reset zoom and pan"
            onClick={resetView} />
        <ReactTooltip />
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
        <div style={{ display: 'flex', flexDirection: 'column', width: '30vw', height: '70vh', overflowY: 'auto', overflowX: 'auto'}}>
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

export function TupleListSelectPopup(props: {
    open: boolean
    header?: ReactNode
    items: [string, string][]
    onSelect: (value: string) => void
    onClose: () => void
}) {
    const { open, items, onSelect, onClose } = props
    const selectItem = (item: string) => { onSelect(item); onClose() }
    return <Popup open={open} closeOnDocumentClick={true} onClose={onClose} contentStyle={{ width: 'max-content' }}>
        <CloseButton onClick={onClose} />
        {props.header}
        <div style={{ display: 'flex', flexDirection: 'column', width: '30vw', height: '70vh', overflowY: 'auto', overflowX: 'auto'}}>
            {items.map(item =>
                <Button
                    key={item[1]}
                    text={item[1]}
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => selectItem(item[0])} />
            )}
        </div>
    </Popup>
}