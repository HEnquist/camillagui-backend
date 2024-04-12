import React from "react"
import "../index.css"
import { Box, MdiButton } from "../utilities/ui-components"
import { mdiVolumeOff, mdiChevronDown } from "@mdi/js"
import { throttle } from "lodash"
import { Range } from "immutable"
import cloneDeep from "lodash/cloneDeep"

type Props = {}

type State = {
    faders: Fader[]
    send_to_dsp: boolean
    visible: boolean
}

export const minVolume = -51

export interface Fader {
    volume: number
    mute: boolean
}


export class FadersPoller {

    private timerId: NodeJS.Timeout | undefined
    private readonly onUpdate: (faders: Fader[]) => void
    private readonly update_interval: number
    private readonly holdoff_interval: number

    constructor(onUpdate: (faders: Fader[]) => void, update_interval: number, holdoff_interval: number) {
        this.onUpdate = onUpdate
        this.update_interval = update_interval
        this.holdoff_interval = holdoff_interval
        this.timerId = setTimeout(this.updateFaders.bind(this), this.update_interval)
    }

    private async updateFaders() {
        this.timerId = undefined
        try {
            let fadersreq = fetch("/api/getparamjson/faders")
            let faders = await (await fadersreq).json() as Fader[]
            // Only update if the timer hasn't been restarted
            // while we were reading the volume and mute settings.
            if (this.timerId === undefined) {
                this.onUpdate(faders.slice(1))
            }
        } catch (err) { console.log("unable to read faders", err) }
        if (this.timerId === undefined) {
            this.timerId = setTimeout(this.updateFaders.bind(this), this.update_interval)
        }
    }

    stop() {
        if (this.timerId !== undefined) {
            clearTimeout(this.timerId)
            this.timerId = undefined
        }
    }

    restart_timer() {
        if (this.timerId !== undefined) {
            clearTimeout(this.timerId)
        }
        this.timerId = setTimeout(this.updateFaders.bind(this), this.holdoff_interval)
    }

}

export class AuxFadersBox extends React.Component<Props, State> {

    private fadersPoller = new FadersPoller(faders => this.setState({ faders: faders }), 1000.0, 2000.0)
    private readonly setDspFadersDebounced: any

    constructor(props: Props) {
        super(props)
        this.toggleMute = this.toggleMute.bind(this)
        this.moveFader = this.moveFader.bind(this)
        this.setDspFadersDebounced = throttle(this.setDspFaders, 250)
        this.state = {
            faders: [
                { volume: -99, mute: false },
                { volume: -99, mute: false },
                { volume: -99, mute: false },
                { volume: -99, mute: false },
            ],
            send_to_dsp: false,
            visible: false
        }
    }

    didFadersChange(faders: Fader[], prevState: Readonly<State>) {
        for (const [idx, fader] of faders.entries()) {
            if (Math.round(fader.volume * 10) !== Math.round(prevState.faders[idx].volume * 10) || fader.mute !== prevState.faders[idx].mute)
                return true
        }
        return false
    }


    componentDidUpdate(prevProps: Readonly<Props>, prevState: Readonly<State>) {
        const { faders, send_to_dsp } = this.state
        // Let's ignore any change smaller than 0.1 dB.
        let changed = this.didFadersChange(faders, prevState)
        if (send_to_dsp) {
            if (changed) {
                // The volume or mute state was changed from this gui instance.
                this.fadersPoller.restart_timer()
                this.setDspFadersDebounced(faders, prevState.faders)
            }
            this.setState({ send_to_dsp: false })
        }
        //Tooltip.rebuild()
    }

    componentWillUnmount() {
        this.fadersPoller.stop()
    }

    private toggleMute(idx: number) {
        this.fadersPoller.restart_timer()
        this.setState(({ faders }) => {
            let new_faders = cloneDeep(faders)
            new_faders[idx].mute = !faders[idx].mute
            return { faders: new_faders, send_to_dsp: true }
        })
    }

    private moveFader(idx: number, value: number) {
        this.fadersPoller.restart_timer()
        this.setState(({ faders }) => {
            let new_faders = cloneDeep(faders)
            new_faders[idx].volume = value
            return { faders: new_faders, send_to_dsp: true }
        })
    }

    private async setDspFaders(faders: Fader[], prevFaders: Fader[]) {
        for (const [idx, fader] of faders.entries()) {
            if (Math.round(fader.volume * 10) !== Math.round(prevFaders[idx].volume * 10)) {
                await fetch("/api/setparamindex/volume/" + (idx + 1), {
                    method: "POST",
                    headers: { "Content-Type": "text/plain; charset=us-ascii" },
                    body: fader.volume.toString(),
                })
            }
            if (fader.mute !== prevFaders[idx].mute) {
                await fetch("/api/setparamindex/mute/" + (idx + 1), {
                    method: "POST",
                    headers: { "Content-Type": "text/plain; charset=us-ascii" },
                    body: fader.mute.toString(),
                })
            }
        }
    }

    render() {
        const { faders, visible } = this.state
        const sliders = Range(0, faders.length).map(index => {
            return <div style={{ display: 'flex', flexDirection: 'row' }}>
                <input
                    style={{ width: '100%', margin: 0, padding: 0 }}
                    type="range"
                    min={10.0 * minVolume}
                    max="0"
                    value={10.0 * faders[index].volume}
                    key={"vol" + index}
                    onChange={e => this.moveFader(index, e.target.valueAsNumber / 10.0)}
                    data-tooltip-html={"Aux" + (index + 1) + " " + faders[index].volume.toFixed(1) + "dB"}
                    data-tooltip-id="main-tooltip"
                />
                <MdiButton
                    key={"mute" + index}
                    icon={mdiVolumeOff}
                    tooltip={faders[index].mute ? "Un-Mute" : "Mute"}
                    buttonSize="small"
                    highlighted={faders[index].mute}
                    onClick={() => (this.toggleMute(index))} />
            </div>
        })
        return <Box title={
            <>
                <MdiButton
                    icon={mdiChevronDown}
                    tooltip={visible ? "Hide Aux volume controls" : "Show Aux volume controls"}
                    buttonSize="small"
                    highlighted={visible}
                    onClick={() => { this.setState({ visible: !visible }) }} />
                Aux faders
            </>
        }>
            {visible && sliders}
        </Box>
    }
}
