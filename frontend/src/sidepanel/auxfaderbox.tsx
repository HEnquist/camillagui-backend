import React from "react"
import "../index.css"
import { Box, MdiButton } from "../utilities/ui-components"
import { mdiVolumeOff } from "@mdi/js"
import { throttle } from "lodash"
import {Range} from "immutable"

type Props = {}

type State = {
    faders: Fader[]
    send_to_dsp: boolean
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
            let fadersreq = fetch("/api/getfaders")
            let faders = await (await fadersreq).json()
            // Only update if the timer hasn't been restarted
            // while we were reading the volume and mute settings.
            if (this.timerId === undefined) {
                this.onUpdate(faders)
            }
        } catch (err) { console.log(err) }
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
        this.setDspFadersDebounced = throttle(this.setDspFaders, 250)
        this.state = {
            faders: [
                {volume: -99, mute: false},
                {volume: -99, mute: false},
                {volume: -99, mute: false},
                {volume: -99, mute: false},
            ],
            send_to_dsp: false
        }
    }

    didVolumeChange(faders: Fader[], prevState: Readonly<State>) {
        for (const [idx, fader] of faders.entries()) {
            if (Math.round(fader.volume * 10) !== Math.round(prevState.faders[idx].volume * 10))
                return true
        }
        return false
    }

    didMuteChange(faders: Fader[], prevState: Readonly<State>) {
        for (const [idx, fader] of faders.entries()) {
            if (fader.mute !== prevState.faders[idx].mute)
                return true
        }
        return false
    }

    componentDidUpdate(prevProps: Readonly<Props>, prevState: Readonly<State>) {
        const { faders, send_to_dsp } = this.state
        // Let's ignore any change smaller than 0.1 dB.
        let vol_changed = this.didVolumeChange(faders, prevState)
        let mute_changed = this.didMuteChange(faders, prevState)
        if (send_to_dsp) {
            if (vol_changed || mute_changed) {
                // The volume or mute state was changed from this gui instance.
                this.fadersPoller.restart_timer()
                this.setDspFadersDebounced(faders, prevState.faders)
                this.setState({ send_to_dsp: false })
            }
        }
    }

    componentWillUnmount() {
        this.fadersPoller.stop()
    }

    private toggleMute(idx: number) {
        this.fadersPoller.restart_timer()
        this.setState(({ faders }) => {
            faders[idx].mute = !faders[idx].mute
            return { faders: faders, send_to_dsp: true }
        })
    }

    private moveFader(idx: number, value: number) {
        this.fadersPoller.restart_timer()
        this.setState(({ faders }) => {
            faders[idx].volume = value
            return { faders: faders, send_to_dsp: true }
        })
    }

    private async setDspFaders(faders: Fader[], prevFaders: Fader[]) {
        // Compare and update what was changed
        //const vol_req = await fetch("/api/setparam/volume", {
        //    method: "POST",
        //    headers: { "Content-Type": "text/plain; charset=us-ascii" },
        //    body: value.toString(),
        //})
    }
//<div className={faders[index].mute ? "db-label-muted" : "db-label"}>
//    {faders[index].volume.toFixed(1)}dB
//</div>

    render() {
        const { faders } = this.state
        const sliders = Range(0, faders.length).map(index => {
            return <div style={{ display: 'flex', flexDirection: 'row' }}>
                <input
                    style={{ width: '100%', margin: 0, padding: 0 }}
                    type="range"
                    min={10.0 * minVolume}
                    max="0"
                    value={10.0 * faders[index].volume}
                    id="volume"
                    onChange={e => this.moveFader(index, e.target.valueAsNumber / 10.0)}
                />
                <MdiButton
                    icon={mdiVolumeOff}
                    tooltip={faders[index].mute ? "Un-Mute" : "Mute"}
                    buttonSize="small"
                    highlighted={faders[index].mute}
                    onClick={() => (this.toggleMute(index))} />
            </div>
        })
        console.log(sliders)
        console.log(faders)
        return <Box title="Aux faders">
            {sliders}
        </Box>
    }
}
