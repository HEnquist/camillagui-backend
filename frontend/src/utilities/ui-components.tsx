import React, { ChangeEvent, CSSProperties, ReactNode, useEffect, useRef, useState } from "react"
import Icon from "@mdi/react"
import Popup from "reactjs-popup"
import { mdiChartBellCurveCumulative, mdiDelete, mdiPlusThick, mdiSitemapOutline, mdiMenuDown } from "@mdi/js"
import 'reactjs-popup/dist/index.css'
import { toMap } from "./arrays"
import { Range } from "immutable"
import DataTable from 'react-data-table-component'
import { FileInfo } from "./files"
import { getLabelForChannel } from "../camilladsp/config"

export function cssStyles(): CSSStyleDeclaration {
    return getComputedStyle(document.body)
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
                <div data-tooltip-html={props.tooltip} data-tooltip-id="main-tooltip" className="horizontally-spaced-content" style={{ alignItems: 'center' }}>
                    {props.title}
                </div>
            </legend>
            {props.children}
        </fieldset>
    )
}

export function CheckBox(props: {
    text?: string
    tooltip?: string
    checked: boolean | "partially"
    editable?: boolean
    onChange: (checked: boolean) => void
    style?: CSSProperties
}) {
    const { tooltip, checked, onChange, style } = props
    const editable = props.editable !== false
    const checkboxRef = useRef<HTMLInputElement>(null)
    const checkbox = checkboxRef.current
    useEffect(() => {
        if (!checkbox)
            return
        if (checked === true) {
            checkbox.checked = true
            checkbox.indeterminate = false
        } else if (checked === false) {
            checkbox.checked = false
            checkbox.indeterminate = false
        } else if (checked === "partially") {
            checkbox.checked = false
            checkbox.indeterminate = true
        }
    }, [checked, checkbox])
    return <label data-tooltip-html={tooltip} data-tooltip-id="main-tooltip" className='checkbox-area' style={style}>
        <input
            type="checkbox"
            data-tooltip-html={tooltip}
            data-tooltip-id="main-tooltip"
            disabled={!editable}
            ref={checkboxRef}
            onChange={(e) => onChange(e.target.checked)} />
        {props.text && <span className="unselectable">{props.text}</span>}
    </label>
}

export function Button(props: {
    text: string
    tooltip?: string
    onClick: () => void
    style?: CSSProperties
    className?: string
    enabled?: boolean
    highlighted?: boolean | null
}) {
    const enabled = props.enabled !== false
    let classNames = 'button button-with-text'
    if (!enabled) classNames += ' disabled-button'
    if (props.highlighted === true) classNames += ' highlighted-button'
    if (props.className) classNames += ' ' + props.className
    return <div
        data-tooltip-html={props.tooltip}
        data-tooltip-id="main-tooltip"
        className={classNames}
        style={props.style}
        onClick={enabled ? props.onClick : () => { }}>
        {props.text}
    </div>
}

export function SuccessFailureButton(props: {
    text: string
    tooltip?: string
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

export function UploadButton(
    props: ({ icon: string, tooltip: string } | { text: string })
        & {
            upload: (files: FileList) => void
            multiple?: boolean
            className?: string
            style?: CSSProperties
            smallButton?: boolean
        }): JSX.Element {
    const style = Object.assign({ verticalAlign: 'bottom' }, props.style)
    const upload = (e: ChangeEvent<HTMLInputElement>) => {
        props.upload(e.target.files!)
        e.target.value = '' // this resets the upload field, so the same file can be uploaded twice in a row
    }
    return (
        <label data-tooltip-html={"tooltip" in props ? props.tooltip : ""} data-tooltip-id="main-tooltip">
            <input style={{ display: 'none' }}
                type="file"
                onChange={upload}
                multiple={props.multiple} />
            {"icon" in props && "tooltip" in props &&
                <MdiButton
                    buttonSize={props.smallButton ? "small" : "default"}
                    icon={props.icon}
                    tooltip={props.tooltip}
                    className={props.className}
                    style={style} />
            }
            {"text" in props &&
                <Button text={props.text} onClick={() => { }} />
            }
        </label>
    )
}

/**
 * Can display an icon from https://materialdesignicons.com/
 */
export function MdiButton(props: {
    icon: string
    tooltip: string
    className?: string
    style?: CSSProperties
    enabled?: boolean
    highlighted?: boolean | null
    rotation?: number
    buttonSize?: "default" | "small" | "tiny"
    onClick?: () => void
}) {
    const { icon, tooltip, className, enabled, highlighted, onClick, buttonSize } = props
    const clickhandler = onClick === undefined || enabled === false ? () => { } : onClick
    let buttonClass = 'button button-with-icon'
    if (enabled === false) buttonClass += ' disabled-button'
    if (buttonSize === "small") buttonClass += ' smallbutton'
    else if (buttonSize === "tiny") buttonClass += ' tinybutton'
    if (highlighted === true) buttonClass += ' highlighted-button'
    if (className !== undefined) buttonClass += ' ' + className
    let rot = {}
    if (props.rotation && props.rotation !== 0)
        rot = { transform: "rotate(" + props.rotation + "deg)" }
    return <div onClick={clickhandler} data-tooltip-html={tooltip} data-tooltip-id="main-tooltip" className={buttonClass} style={props.style}>
        <Icon path={icon} size={buttonSize === "tiny" ? '15px' : '24px'} style={rot} />
    </div>
}

/**
 * Can display an icon from https://materialdesignicons.com/
 */
export function MdiIcon(props: {
    icon: string
    tooltip?: string
    style?: CSSProperties
}) {
    return <span data-tooltip-html={props.tooltip} data-tooltip-id="main-tooltip" style={props.style}>
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
    tooltip: string
    children: ReactNode
    small?: boolean
    style?: CSSProperties
}) {
    const settingStyle = props.small ? { width: 'min-content' } : {}
    const combinedStyle = Object.assign(settingStyle, props.style)
    return <label className="setting" data-tooltip-html={props.tooltip} data-tooltip-id="main-tooltip" style={combinedStyle}>
        <span className="setting-label">{props.desc}</span>
        {props.children}
    </label>
}

export function IntOption(props: {
    value: number
    error?: string
    desc: string
    tooltip: string
    onChange: (value: number) => void
    small?: boolean
    withControls?: boolean
    min?: number
    max?: number
    style?: CSSProperties
}) {
    const { error, desc, small, style } = props
    return <>
        <OptionLine desc={desc} tooltip={props.tooltip} small={small} style={style}>
            <IntInput
                {...props}
                className={'setting-input' + (small ? ' small-setting-input' : '')}
                style={error ? ERROR_BACKGROUND_STYLE : undefined} />
        </OptionLine>
        <ErrorMessage message={error} />
    </>
}

export function OptionalIntOption(props: {
    value: number | null
    error?: string
    desc: string
    tooltip: string
    onChange: (value: number | null) => void
    small?: boolean
    withControls?: boolean
    min?: number
    max?: number
}) {
    const small = props.small
    return <>
        <OptionLine desc={props.desc} tooltip={props.tooltip} small={small}>
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
    tooltip: string
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
    tooltip: string
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
        asString={(int: number | null) => int !== null ? int.toString() : ""}
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
    tooltip: string
    onChange: (value: number) => void
}) {
    return <>
        <OptionLine desc={props.desc} tooltip={props.tooltip}>
            <FloatInput
                value={props.value}
                tooltip={props.tooltip}
                onChange={props.onChange}
                className="setting-input" />
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}

export function FloatInput(props: {
    value: number
    error?: boolean
    tooltip: string
    onChange: (value: number) => void
    className?: string
    style?: CSSProperties
}) {
    return <ParsedInput
        value={props.value}
        immediate={true}
        tooltip={props.tooltip}
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
    value: number | null
    error?: string
    desc: string
    tooltip: string
    onChange: (value: number | null) => void
    placeholder?: string
}) {
    return <>
        <OptionLine desc={props.desc} tooltip={props.tooltip}>
            <OptionalFloatInput
                value={props.value}
                tooltip={props.tooltip}
                onChange={props.onChange}
                placeholder={props.placeholder}
                className="setting-input" />
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}

export function OptionalFloatInput(props: {
    value: number | null
    error?: boolean
    tooltip: string
    onChange: (value: number | null) => void
    className?: string
    style?: CSSProperties
    placeholder?: string
}) {
    return <OptionalParsedInput
        value={props.value}
        immediate={true}
        tooltip={props.tooltip}
        onChange={props.onChange}
        placeholder={props.placeholder}
        asString={(float?: number | null) => (float === undefined || float === null) ? "" : float.toString()}
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
    tooltip: string
    onChange: (value: number[]) => void
}) {
    return <>
        <OptionLine desc={props.desc} tooltip={props.tooltip}>
            <ParsedInput
                className="setting-input"
                immediate={true}
                value={props.value}
                tooltip={props.tooltip}
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

export function LabelListOption(props: {
    value: string | null
    error?: string
    desc: string
    onChange: (labels: (string|null)[] | null) => void
    onButtonClick: () => void
  }) {

    const updateChannelLabels = (labels_str: string | null) => {
        let labels: (string|null)[] = []
        if (labels_str === null) {
          props.onChange(null)
          return
        }
        for (let label of labels_str.split(",")) {
          let cleaned_label = label === "" ? null : label.trim()
          labels.push(cleaned_label)
        }
        console.log("Update labels to", labels)
        props.onChange(labels)
      }

    return <div className="setting" data-tooltip-html="Name of device">
      <label htmlFor={props.desc} className="setting-label">{props.desc}</label>
      <OptionalTextInput
          value={props.value}
          tooltip="Name of device"
          className="setting-input"
          style={{width: '87%'}}
          onChange={updateChannelLabels}/>
      <MdiButton
          icon={mdiMenuDown}
          tooltip="Pick a device"
          onClick={props.onButtonClick}
          className='setting-button'
          style={{width: '13%'}}
          buttonSize="small"
      />
      <ErrorMessage message={props.error}/>
    </div>
  }


type ParsedInputProps<TYPE> = {
    style?: CSSProperties
    className?: string
    value: TYPE
    tooltip: string
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
            event.preventDefault()
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
            spellCheck="false"
            type={props.withControls ? "number" : "text"}
            min={props.min}
            max={props.max}
            value={this.state.rawValue}
            placeholder={props.placeholder}
            data-tooltip-html={props.tooltip}
            data-tooltip-id="main-tooltip"
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
    tooltip: string
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
            event.preventDefault()
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
            spellCheck="false"
            placeholder={placeholder}
            type={props.withControls ? "number" : "text"}
            min={props.min}
            max={props.max}
            value={this.state.rawValue}
            data-tooltip-html={props.tooltip}
            data-tooltip-id="main-tooltip"
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
    tooltip: string
    small?: boolean
    onChange: (value: boolean) => void
}) {
    const small = props.small
    return <>
        <OptionLine desc={props.desc} tooltip={props.tooltip} small={small}>
            <div className={"setting-input" + (small ? " small-setting-input" : "")}
                data-tooltip-html={props.tooltip}
                data-tooltip-id="main-tooltip"
                style={{ cursor: 'pointer' }}>
                <input
                    style={{ marginLeft: 0, marginTop: '8px', marginBottom: '8px' }}
                    type="checkbox"
                    checked={props.value}
                    data-tooltip-html={props.tooltip}
                    data-tooltip-id="main-tooltip"
                    onChange={(e) => props.onChange(e.target.checked)} />
            </div>
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}

export function OptionalBoolOption(props: {
    value: boolean | null
    error?: string
    desc: string
    tooltip: string
    small?: boolean
    onChange: (value: boolean | null) => void
}) {
    const small = props.small
    return <>
        <OptionLine desc={props.desc} tooltip={props.tooltip} small={small}>
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
    tooltip: string
    className?: string
    onChange: (value: OPTION) => void
}) {
    const className = 'setting-input' + (props.className ? ' ' + props.className : '')
    return <>
        <OptionLine desc={props.desc} tooltip={props.tooltip}>
            <EnumInput {...props} className={className} style={props.error ? ERROR_BACKGROUND_STYLE : undefined} />
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}


export function add_default_option<OPTION extends string>(options: OPTION[], defaultValue: string): void {
    options.unshift(defaultValue as OPTION)
}

export function null_to_default<OPTION extends string>(value: OPTION | null, defaultValue: string): OPTION {
    if (value === null)
        return defaultValue as OPTION
    return value
}

export function default_to_null<OPTION extends string>(value: OPTION, defaultValue: string): OPTION | null {
    if (value === defaultValue)
        return null
    return value
}

export function OptionalEnumOption<OPTION extends string>(props: {
    value: OPTION | null
    options: OPTION[]
    error?: string
    desc: string
    tooltip: string
    className?: string
    placeholder?: string
    onChange: (value: OPTION | null) => void
}) {
    const defaultValue = props.placeholder ? props.placeholder : "default"
    const className = 'setting-input' + (props.className ? ' ' + props.className : '')
    add_default_option(props.options, defaultValue)
    return <>
        <OptionLine desc={props.desc} tooltip={props.tooltip}>
            <EnumInput
                value={null_to_default(props.value, defaultValue)}
                options={props.options}
                desc={props.desc}
                tooltip={props.tooltip}
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
    tooltip: string
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
        data-tooltip-html={props.tooltip}
        data-tooltip-id="main-tooltip"
        onChange={e => props.onChange(e.target.value as OPTION)}
        style={props.style}
        className={value === "default" ? props.className + "-default" : props.className}
    >
        {Object.keys(optionsMap).map(key => <option key={key} value={key}>{optionsMap[key]}</option>)}
    </select>
}

function string_to_bool(valuestr: string): boolean | null {
    switch (valuestr) {
        case "default":
            return null
        case "yes":
            return true
        case "no":
            return false
    }
    return null
}

function bool_to_string(value: boolean | null): string {
    switch (value) {
        case null:
            return "default"
        case true:
            return "yes"
        case false:
            return "no"
    }
}

export function OptionalBoolInput(props: {
    value: boolean | null
    desc: string
    tooltip: string
    style?: CSSProperties
    className?: string
    onChange: (value: boolean | null) => void
}) {
    let valuestring = bool_to_string(props.value)

    return <select
        id={props.desc}
        name={props.desc}
        value={valuestring}
        data-tooltip-html={props.tooltip}
        data-tooltip-id="main-tooltip"
        onChange={e => props.onChange(string_to_bool(e.target.value))}
        style={props.style}
        className={valuestring === "default" ? props.className + "-default" : props.className}
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
    tooltip: string
    onChange: (value: string) => void
}) {
    return <>
        <OptionLine desc={props.desc} tooltip={props.tooltip}>
            <TextInput
                className="setting-input"
                value={props.value}
                tooltip={props.tooltip}
                style={props.error ? ERROR_BACKGROUND_STYLE : undefined}
                onChange={props.onChange} />
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}

export function OptionalTextOption(props: {
    value: string | null
    error?: string
    desc: string
    tooltip: string
    onChange: (value: string | null) => void
    placeholder?: string
}) {
    return <>
        <OptionLine desc={props.desc} tooltip={props.tooltip}>
            <OptionalTextInput
                placeholder={props.placeholder === undefined ? "default" : props.placeholder}
                className="setting-input"
                value={props.value}
                tooltip={props.tooltip}
                style={props.error ? ERROR_BACKGROUND_STYLE : undefined}
                onChange={props.onChange} />
        </OptionLine>
        <ErrorMessage message={props.error} />
    </>
}

export function OptionalTextInput(props: {
    value: string | null
    tooltip: string
    className?: string
    style?: CSSProperties
    onChange: (value: string | null) => void
    placeholder?: string
}) {
    return <input
        spellCheck="false"
        placeholder={props.placeholder}
        type="text"
        value={props.value === null ? "" : props.value}
        data-tooltip-html={props.tooltip}
        data-tooltip-id="main-tooltip"
        className={props.className}
        style={props.style}
        onChange={e => e.target.value === "" ? props.onChange(null) : props.onChange(e.target.value)} />
}

export function TextInput(props: {
    value: string
    tooltip: string
    className?: string
    style?: CSSProperties
    onChange: (value: string) => void
    placeholder?: string
}) {
    return <input
        spellCheck="false"
        placeholder={props.placeholder}
        type="text"
        value={props.value}
        data-tooltip-html={props.tooltip}
        data-tooltip-id="main-tooltip"
        className={props.className}
        style={props.style}
        onChange={e => props.onChange(e.target.value)} />
}

export function MultilineTextInput(props: {
    value: string
    tooltip: string
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
        data-tooltip-html={props.tooltip}
        data-tooltip-id="main-tooltip"
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

export const fileNameSort = (rowA: FileInfo, rowB: FileInfo) => {
	const a = rowA.name.toLowerCase();
	const b = rowB.name.toLowerCase();
	if (a > b) {
		return 1
	}
	if (b > a) {
		return -1
	}
	return 0
}

const caseInsensitiveRowSort = (rowA: [string, string], rowB: [string, string]) => {
	const a = rowA[1].toLowerCase();
	const b = rowB[1].toLowerCase();
	if (a > b) {
		return 1
	}
	if (b > a) {
		return -1
	}
	return 0
}


export const fileDateSort = (rowA: FileInfo, rowB: FileInfo) => {
	const a = rowA.lastModified;
	const b = rowB.lastModified;
	if (a > b) {
		return 1
	}
	if (b > a) {
		return -1
	}
	return 0
}

export function FileSelectPopup(props: {
    open: boolean
    header?: ReactNode
    files: FileInfo[]
    onSelect: (value: string) => void
    onClose: () => void
}) {
    const { open, files, onSelect, onClose } = props
    const selectItem = (item: FileInfo) => { onSelect(item.name); onClose() }
    const [filterText, setFilterText] = React.useState('');
    var columns: any= [
        {
          name: 'Filename',
          selector: (row: FileInfo) => row.name,
          sortFunction: fileNameSort,
          sortable: true
        },
        {
          name: 'Date',
          selector: (row: FileInfo) => row.formattedDate,
          sortFunction: fileDateSort,
          sortable: true,
          maxWidth: '200px'
        },
        {
          name: 'Size',
          selector: (row: FileInfo) => row.size,
          sortable: true,
          maxWidth: '100px'
        }
      ]
    const filteredFiles = files.filter(
        item => item.name.toLowerCase().includes(filterText.toLowerCase()),
    )
    return <Popup open={open} closeOnDocumentClick={true} onClose={onClose} contentStyle={{ width: 'max-content' }}>
        <div style={{margin: '5px'}}>
            <span style={{float: 'right'}}><CloseButton onClick={onClose} /></span>
            {props.header}
        </div>
        <div style={{ margin: '5px', width: '60vw', height: '80vh', overflowY: 'scroll'}}>
        <input type="search" placeholder="Filter on name.."
                value={filterText}
                data-tooltip-html="Enter a search string to filter files on name"
                data-tooltip-id="main-tooltip"
                spellCheck='false'
                onChange={(e) => setFilterText(e.target.value)}/>
            <DataTable columns={columns} data={filteredFiles} theme='camilla' onRowClicked={selectItem} highlightOnHover pointerOnHover/>
        </div>
    </Popup>
}

export function KeyValueSelectPopup(props: {
    open: boolean
    header?: ReactNode
    items: [string, string][]
    onSelect: (value: string) => void
    onClose: () => void
}) {
    const { open, items, onSelect, onClose } = props
    const [filterText, setFilterText] = React.useState('');
    var columns: any = [
        {
          name: 'Name',
          selector: (row: [String, String]) => row[1],
          sortFunction: caseInsensitiveRowSort,
          sortable: true
        }
      ]
    const selectItem = (item: [string, string]) => { onSelect(item[0]); onClose() }
    const filteredItems = items.filter(
        item => item[1].toLowerCase().includes(filterText.toLowerCase()),
    )
    return <Popup open={open} closeOnDocumentClick={true} onClose={onClose} contentStyle={{ width: 'max-content' }}>
        <div style={{margin: '5px'}}>
            <span style={{float: 'right'}}><CloseButton onClick={onClose} /></span>
            {props.header}
        </div>
        <div style={{ margin: '5px', width: '30vw', height: '80vh', overflowY: 'scroll'}}>
            <input type="search" placeholder="Filter on name.."
                value={filterText}
                data-tooltip-html="Enter a search string to filter files on name"
                data-tooltip-id="main-tooltip"
                spellCheck='false'
                onChange={(e) => setFilterText(e.target.value)}/>
            <DataTable columns={columns} data={filteredItems} theme='camilla' onRowClicked={selectItem} highlightOnHover pointerOnHover/>
        </div>
    </Popup>
}


export function ChannelSelection(props: {
    channels: number[] | null
    maxChannelCount: number
    label: string | null
    setChannels: (channels: number[] | null) => void
    labels?: (string|null)[] | null
}) {
    const { channels, maxChannelCount, setChannels, label, labels } = props
    let [expanded, setExpanded] = useState(false)

    if (props.channels?.find((ch: number) => ch >= props.maxChannelCount)) {
        props.setChannels(props.channels.filter((ch: number) => ch < props.maxChannelCount))
    }

    const rowSize = 8

    var _channels = channels
    const toggleAllChannels = () => {
        if (_channels === null) {
            _channels = []
        }
        else {
            _channels = null
        }
        setChannels(_channels)
    }
    const toggleChannel = (idx: number) => {
        if (_channels === null) {
            _channels = []
        }
        if (!_channels.includes(idx)) {
            _channels.push(idx)
        }
        else {
            _channels = _channels.filter((n: number) => n !== idx)
        }
        setChannels(_channels)
    }
    const toggleExpanded = () => {
        setExpanded(!expanded)
    }

    const rows = Math.ceil(maxChannelCount / rowSize)

    const makeDropdown = () => {
        return <div className="dropdown-menu" title='channels' >
            <table>
                {Range(0, rows).map(row => (
                    <tr>
                        {Range(0, Math.min(rowSize, maxChannelCount - rowSize * row)).map(col => (
                            <td>
                                <ChannelButton key={rowSize * row + col} channel={rowSize * row + col} selected={channels !== null && channels.includes(rowSize * row + col)} onClick={() => toggleChannel(rowSize * row + col)} />
                            </td>
                        ))}
                    </tr>
                ))}
            </table>
        </div>
    }

    if (rows === 1) {
        return <div style={{ marginRight: '10px', display: 'flex', flexDirection: 'row', alignItems: 'last baseline' }}>
            {label && <span style={{ marginRight: '5px' }}>{label}</span>}
            <ChannelButton key={-1} channel='all' selected={channels === null} onClick={toggleAllChannels} />
            {Range(0, maxChannelCount).map(index =>
                <ChannelButton key={index} channel={getLabelForChannel(labels, index)} selected={channels !== null && channels.includes(index)} onClick={() => toggleChannel(index)} />
            )}
        </div>
    }
    else {
        // TODO add some compact display?
        return <div style={{ marginRight: '10px', display: 'flex', flexDirection: 'row', alignItems: 'last baseline' }}>
            {label && <span style={{ marginRight: '5px' }}>{label}</span>}
            <CompactChannelIndicator channels={channels} channelCount={maxChannelCount} />
            <ChannelButton key='all' channel='all' selected={channels === null} onClick={toggleAllChannels} />
            <div className='dropdown' style={{ display: 'flex', flexDirection: 'row', alignItems: 'last baseline' }}>
                <ChannelButton key='expand' channel='▼' selected={expanded} onClick={toggleExpanded} />
                {expanded && makeDropdown()}
            </div>
        </div>
    }
}

function CompactChannelIndicator(props: {
    channelCount: number,
    channels: number[] | null
}) {
    return <div className='channel-indicator-field'>
        {Range(0, props.channelCount).map(ch =>
            <div className='channel-indicator' style={{
                backgroundColor: (props.channels === null || props.channels.includes(ch)) ? 'var(--highlighted-button-border-color)' : 'var(--button-background-color)'
            }}></div>)
        }
    </div>
}

export function ChannelButton(props: {
    channel: number | string
    selected: boolean
    onClick: () => void
    erroneousChannel?: boolean
}) {
    const { channel, selected, onClick, erroneousChannel } = props
    return <Button
        text={channel.toString()}
        onClick={onClick}
        highlighted={selected}
        className='setting-button'
        style={{
            height: '28px',
            marginRight: '5px',
            backgroundColor: erroneousChannel ? 'var(--error-field-background-color)' : undefined
        }}
    />
}