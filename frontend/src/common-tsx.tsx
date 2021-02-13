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

export function IntInput(props:{
    value: number
    desc: string
    'data-tip': string
    onChange: (value: number) => void
    withControls?: boolean
    min?: number
}) {
    return <ParsedInput
        value={props.value}
        desc={props.desc}
        data-tip={props["data-tip"]}
        onChange={props.onChange}
        withControls={props.withControls}
        min={props.min}
        asString={(int: number) => int.toString()}
        parseValue={(rawValue: string) => {
            const parsedvalue = parseInt(rawValue)
            return isNaN(parsedvalue) ? undefined : parsedvalue
        }}
    />
}

export function FloatInput(props:{
    value: number
    desc: string
    'data-tip': string
    onChange: (value: number) => void
}) {
    return <ParsedInput
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
}

type ParsedInputProps<TYPE> = {
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
        const parsedValue = this.props.parseValue(this.state.rawValue)
        let valid = parsedValue !== undefined
        return <label className="setting" data-tip={this.props['data-tip']}>
            {this.props.desc}
            <input
                className="setting-input"
                type={this.props.withControls ? "number" : "text"}
                min={this.props.min}
                value={this.state.rawValue}
                data-tip={this.props["data-tip"]}
                style={{backgroundColor: valid ? "#FFFFFF" : "#FFAAAA"}}
                onChange={(e) => this.updateValue(e.target.value)}/>
        </label>
    }

}

export function BoolInput(props: {
    value: boolean,
    desc: string,
    'data-tip': string
    onChange: (value: boolean) => void
}) {
    return <label className="setting" style={{margin: '4px 0 4px 0'}}>
        {props.desc}
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
    </label>
}

export function EnumInput<OPTION extends string>(props: {
    value: OPTION,
    options: OPTION[],
    desc: string,
    'data-tip': string,
    onChange: (value: OPTION) => void
}) {
    return <label className="setting" data-tip={props["data-tip"]}>
        {props.desc}
        <select className="setting-input"
                name={props.desc}
                value={props.value}
                data-tip={props["data-tip"]}
                onChange={e => props.onChange(e.target.value as OPTION)}>
            {props.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
    </label>
}

export function TextInput(props: {
    value: string,
    desc: string,
    'data-tip': string
    onChange: (value: string) => void
}) {
    return <label className="setting" data-tip={props['data-tip']}>
        {props.desc}
        <input
            className="setting-input"
            type="text"
            value={props.value}
            data-tip={props["data-tip"]}
            onChange={(e) => props.onChange(e.target.value)}
        />
    </label>
}