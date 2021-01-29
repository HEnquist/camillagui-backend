import React, {ChangeEvent, CSSProperties} from "react";
import Icon from "@mdi/react";

type JsxChild = string | JSX.Element | JSX.IntrinsicElements | false | null
export type JsxChildren = JsxChild | Array<JsxChild>

export function download(filename: string, blob: any) {
    let a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.hidden = true;
    document.body.appendChild(a);
    a.innerHTML = "abcdefg";
    a.click();
}

export function Box(props: {
    title: string,
    children: JsxChildren
}) {
    return (
        <fieldset className="box">
            <legend>{props.title}</legend>
            {props.children}
        </fieldset>
    );
}

export function CheckBox(props: {
    tooltip: string,
    checked: boolean,
    onChange: () => void,
    style?: CSSProperties
}) {
    const {tooltip, checked, onChange, style} = props
    return <label title={tooltip} className='checkbox-area' style={style}>
        <input type="checkbox" title={tooltip} checked={checked} onChange={onChange}/>
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
    const clickhandler = onClick === null || enabled === false ? () => {} : onClick
    let buttonClass = enabled !== false ? 'button' : 'disabled-button';
    if (className !== undefined)
        buttonClass = `${buttonClass} ${className}`
    return <div onClick={clickhandler}>
        <Icon path={icon} title={tooltip} className={buttonClass} size={1}/>
    </div>
}