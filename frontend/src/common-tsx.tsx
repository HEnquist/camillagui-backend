import React, {ChangeEvent, CSSProperties, ReactNode} from "react"
import Icon from "@mdi/react"

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

export function Box(props: {
    title: string,
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

export function UploadButton(props: {
    onChange: (event: ChangeEvent<HTMLInputElement>) => void,
    tooltip: string,
    content: string | JSX.Element,
    multiple?: boolean
}): JSX.Element {
    const className = typeof props.content === 'string' ? 'button' : ''
    return (
        <label className={className} data-tip={props.tooltip}>
            <input style={{display: 'none'}} type="file" onChange={props.onChange} multiple={props.multiple}/>
            {props.content}
        </label>
    )
}

export function MdiButton(props: {
    icon: string,
    tooltip: string,
    className?: string,
    enabled?: boolean,
    onClick?: () => void
}) {
    const { icon, tooltip, className, enabled, onClick } = props
    const clickhandler = onClick === undefined || enabled === false ? () => {} : onClick
    let buttonClass = enabled !== false ? 'button' : 'disabled-button'
    if (className !== undefined)
        buttonClass = `${buttonClass} ${className}`
    return <div onClick={clickhandler}>
        <Icon path={icon} data-tip={tooltip} className={buttonClass} size={1}/>
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
    desc: string
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
            desc={props.desc}
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

type ParsedInputProps<TYPE> = {
    style?: CSSProperties
    className?: string
    value: TYPE
    desc: string
    'data-tip': string
    onChange: (value: TYPE) => void
    asString: (value: TYPE) => string
    parseValue: (rawValue: string) => TYPE | undefined
    withControls?: boolean
    min?: number
}

class ParsedInput<TYPE> extends React.Component<ParsedInputProps<TYPE>, { rawValue: string }> {

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
            id={props.desc}
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
             style={{textAlign: 'left', cursor: 'pointer', display: 'inline-block'}}>
            <input
                style={{marginLeft: 0}}
                type="checkbox"
                checked={props.value}
                data-tip={props["data-tip"]}
                onChange={(e) => props.onChange(e.target.checked)}/>
        </div>
    </OptionLine>
}

export function EnumOption<OPTION extends string>(props: {
    value: OPTION,
    options: OPTION[],
    desc: string,
    'data-tip': string,
    onChange: (value: OPTION) => void
}) {
    return <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
        <EnumInput {...props} className="setting-input"/>
    </OptionLine>
}

export function EnumInput<OPTION extends string>(props: {
    value: OPTION,
    options: OPTION[],
    desc: string,
    'data-tip': string,
    style?: CSSProperties,
    className?: string
    onChange: (value: OPTION) => void
}) {
    return <select
        name={props.desc}
        value={props.value}
        data-tip={props["data-tip"]}
        onChange={e => props.onChange(e.target.value as OPTION)}
        style={props.style}
        className={props.className}>
        {props.options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
}

export function TextOption(props: {
    value: string,
    desc: string,
    'data-tip': string
    onChange: (value: string) => void
}) {
    return <OptionLine desc={props.desc} data-tip={props["data-tip"]}>
        <input
            className="setting-input"
            type="text"
            value={props.value}
            data-tip={props["data-tip"]}
            onChange={(e) => props.onChange(e.target.value)}/>
    </OptionLine>
}