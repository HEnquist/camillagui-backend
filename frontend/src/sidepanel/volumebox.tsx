import React from "react"
import "../index.css"
import { VuMeterGroup } from "./vumeter"
import { Box, MdiButton } from "../utilities/ui-components"
import { mdiVolumeMedium, mdiVolumeOff } from "@mdi/js"
import { VuMeterStatus } from "../camilladsp/status"

type Props = {
    vuMeterStatus: VuMeterStatus
    setMessage: (message: string) => void
}

type State = {
    volume: number
    mute: boolean
    dim: boolean
    send_to_dsp: boolean
}

export const minVolume = -51

export interface Volume {
    volume: number
    mute: boolean
}

export class VolumePoller {

    private timerId: NodeJS.Timeout | undefined
    private readonly onUpdate: (volume: Volume) => void
    private update_interval: number
    private holdoff_interval: number

    constructor(onUpdate: (volume: Volume) => void, update_interval: number, holdoff_interval: number) {
        this.onUpdate = onUpdate
        this.update_interval = update_interval
        this.holdoff_interval = holdoff_interval
        this.timerId = setTimeout(this.updateVolume.bind(this), this.update_interval)
    }

    private async updateVolume() {
        this.timerId = undefined
        console.log("poll volume")
        try {
            let volreq = fetch("/api/getparam/volume")
            let mutereq = fetch("/api/getparam/mute")
            let vol = await (await volreq).text()
            let mute = await (await mutereq).text()
            let volume: Volume = {
                volume: parseFloat(vol),
                mute: mute === "True" ? true : false,
            }
            this.onUpdate(volume)
        } catch (err) { console.log(err) }
        if (this.timerId === undefined) {
            console.log("start new normal timer")
            this.timerId = setTimeout(this.updateVolume.bind(this), this.update_interval)
        }
    }

    stop() {
        if (this.timerId !== undefined) { 
            clearTimeout(this.timerId)
            this.timerId = undefined
        }
    }

    restart_timer() {
        console.log("restart volume poll interval")
        if (this.timerId !== undefined) {
            console.log("clear timer")
            clearTimeout(this.timerId)
        }
        console.log("start new slow timer")
        this.timerId = setTimeout(this.updateVolume.bind(this), this.holdoff_interval)
    }

}

export class VolumeBox extends React.Component<Props, State> {

    private volumePoller = new VolumePoller(cdspVolume => this.setState({ volume: cdspVolume.volume, mute: cdspVolume.mute }), 1000.0, 2000.0)

    constructor(props: Props) {
        super(props)
        this.toggle_mute = this.toggle_mute.bind(this)
        this.toggle_dim = this.toggle_dim.bind(this)
        this.state = { volume: -99, mute: false, dim: false, send_to_dsp: false }
    }

    componentDidUpdate(prevProps: Readonly<Props>, prevState: Readonly<State>, snapshot?: any) {
        const { volume, mute, send_to_dsp } = this.state
        if (send_to_dsp) {
            if (volume !== prevState.volume)
                this.setVolume(volume)
            if (mute !== prevState.mute)
                this.setMute(mute)
            this.volumePoller.restart_timer()
            this.setState({ send_to_dsp: false })
        }
    }

    componentWillUnmount() {
        this.volumePoller.stop()
    }

    private toggle_mute() {
        this.setState(({ mute }) => ({ mute: !mute, send_to_dsp: true }))
    }

    private toggle_dim() {
        this.setState(({ volume, dim }) => ({
            volume: volume + (dim ? 20.0 : -20.0),
            dim: !dim,
            send_to_dsp: true
        }))
    }

    private async setVolume(value: number) {
        const vol_req = await fetch("/api/setparam/volume", {
            method: "POST",
            headers: { "Content-Type": "text/plain; charset=us-ascii" },
            body: value.toString(),
        })
        const message = await vol_req.text()
        this.props.setMessage(message)
    }

    private async setMute(value: boolean) {
        const mute_req = await fetch("/api/setparam/mute", {
            method: "POST",
            headers: { "Content-Type": "text/plain; charset=us-ascii" },
            body: value.toString(),
        })
        const message = await mute_req.text()
        this.props.setMessage(message)
    }

    render() {
        const { capturesignalrms, capturesignalpeak, playbacksignalpeak, playbacksignalrms, clipped }
            = this.props.vuMeterStatus
        const { volume, mute, dim } = this.state
        return <Box title={
            <>
                Volume
                <div className={mute ? "db-label-muted" : "db-label"}>
                    {volume}dB
                </div>
                <MdiButton
                    icon={mdiVolumeOff}
                    tooltip={mute ? "Un-Mute" : "Mute"}
                    buttonSize="small"
                    className={mute ? "highlighted-button" : ""}
                    onClick={this.toggle_mute} />
                <MdiButton
                    icon={mdiVolumeMedium}
                    tooltip={dim ? "Un-Dim" : "Dim (-20dB)"}
                    buttonSize="small"
                    className={dim ? "highlighted-button" : ""}
                    enabled={dim || volume >= minVolume + 20}
                    onClick={this.toggle_dim} />
            </>
        }>
            <VuMeterGroup
                title="In"
                levels={capturesignalrms}
                peaks={capturesignalpeak}
                clipped={clipped}
            />
            <input
                style={{ width: '100%', margin: 0, padding: 0 }}
                type="range"
                min={minVolume}
                max="0"
                value={volume}
                //disabled={mute}
                id="volume"
                onChange={e => this.setState({ volume: e.target.valueAsNumber, dim: false, send_to_dsp: true })}
            //onChange={e => this.volumeDragged(e.target.valueAsNumber)}
            />
            <VuMeterGroup
                title="Out"
                levels={playbacksignalrms}
                peaks={playbacksignalpeak}
                clipped={clipped}
            />
        </Box>
    }
}
