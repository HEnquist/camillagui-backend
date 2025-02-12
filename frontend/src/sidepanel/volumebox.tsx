import React from "react"
import "../index.css"
import {VuMeterGroup} from "./vumeter"
import {Box, MdiButton} from "../utilities/ui-components"
import {mdiVolumeMedium, mdiVolumeOff} from "@mdi/js"
import {VuMeterStatus} from "../camilladsp/status"
import {throttle} from "lodash"
import {GuiConfig} from "../guiconfig"

type Props = {
    vuMeterStatus: VuMeterStatus
    setMessage: (message: string) => void
    inputLabels: null | (string|null)[]
    outputLabels: null | (string|null)[]
    guiConfig: GuiConfig
}

type State = Volume & {
    dim: boolean
    send_to_dsp: boolean
}

export interface Volume {
    volume: number
    mute: boolean
}

export class VolumePoller {

    private timerId: NodeJS.Timeout | undefined
    private readonly onUpdate: (volume: Volume) => void
    private readonly update_interval: number
    private readonly holdoff_interval: number

    constructor(onUpdate: (volume: Volume) => void, update_interval: number, holdoff_interval: number) {
        this.onUpdate = onUpdate
        this.update_interval = update_interval
        this.holdoff_interval = holdoff_interval
        this.timerId = setTimeout(this.updateVolume.bind(this), this.update_interval)
    }

    private async updateVolume() {
        this.timerId = undefined
        try {
            const volreq = await fetch("/api/getparam/volume")
            const mutereq = await fetch("/api/getparam/mute")
            const volume: Volume = volreq.ok && mutereq.ok ?
                {
                    volume: parseFloat(await volreq.text()),
                    mute: "True" === await mutereq.text(),
                } : {
                    volume: Number.NEGATIVE_INFINITY,
                    mute: false
                }
            // Only update if the timer hasn't been restarted
            // while we were reading the volume and mute settings.
            if (this.timerId === undefined) {
                this.onUpdate(volume)
            }
        } catch (err) { console.log(err) }
        if (this.timerId === undefined) {
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
        if (this.timerId !== undefined) {
            clearTimeout(this.timerId)
        }
        this.timerId = setTimeout(this.updateVolume.bind(this), this.holdoff_interval)
    }

}

export class VolumeBox extends React.Component<Props, State> {

    private volumePoller = new VolumePoller(cdspVolume => this.setState({ ...cdspVolume }), 1000.0, 2000.0)
    private readonly setDspVolumeDebounced: any

    constructor(props: Props) {
        super(props)
        this.toggleMute = this.toggleMute.bind(this)
        this.toggleDim = this.toggleDim.bind(this)
        this.setDspVolumeDebounced = throttle(this.setDspVolume, 250)
        this.state = { volume: Number.NEGATIVE_INFINITY, mute: false, dim: false, send_to_dsp: false }
    }

    componentDidUpdate(prevProps: Readonly<Props>, prevState: Readonly<State>) {
        const { volume, mute, send_to_dsp } = this.state
        // Let's ignore any change smaller than 0.1 dB.
        let vol_changed = Math.round(volume * 10) !== Math.round(prevState.volume * 10)
        let mute_changed = mute !== prevState.mute
        if (send_to_dsp) {
            if (vol_changed || mute_changed) {
                // The volume or mute state was changed from this gui instance.
                this.volumePoller.restart_timer()
                if (vol_changed)
                    this.setDspVolumeDebounced(volume)
                if (mute_changed)
                    this.setDspMute(mute)
                this.setState({ send_to_dsp: false })
            }
        } else if (vol_changed) {
            // The volume was changed from somewhere else.
            this.setState({ dim: false })
        }
    }

    componentWillUnmount() {
        this.volumePoller.stop()
    }

    private toggleMute() {
        this.volumePoller.restart_timer()
        this.setState(({ mute }) => ({ mute: !mute, send_to_dsp: true }))
    }

    private toggleDim() {
        this.volumePoller.restart_timer()
        this.setState(({ volume, dim }) => ({
            volume: volume + (dim ? 20.0 : -20.0),
            dim: !dim,
            send_to_dsp: true
        }))
    }

    private changeVolume(volume: number) {
        this.volumePoller.restart_timer()
        this.setState({
            volume: volume,
            dim: false,
            send_to_dsp: true
        })
    }

    private async setDspVolume(value: number) {
        const vol_req = await fetch("/api/setparam/volume", {
            method: "POST",
            headers: { "Content-Type": "text/plain; charset=us-ascii" },
            body: value.toString(),
        })
        const message = await vol_req.text()
        this.props.setMessage(message)
    }

    private async setDspMute(value: boolean) {
        const mute_req = await fetch("/api/setparam/mute", {
            method: "POST",
            headers: { "Content-Type": "text/plain; charset=us-ascii" },
            body: value.toString(),
        })
        const message = await mute_req.text()
        this.props.setMessage(message)
    }

    render() {
        const { volume, mute, dim } = this.state
        if (volume === Number.NEGATIVE_INFINITY)
            return null
        const { capturesignalrms, capturesignalpeak, playbacksignalpeak, playbacksignalrms } = this.props.vuMeterStatus
        const maxVol = this.props.guiConfig.volume_max
        const minVol = maxVol - this.props.guiConfig.volume_range
        return <Box title={
            <>
                Volume
                <div className={mute ? "db-label-muted" : "db-label"}>
                    {volume.toFixed(1)}dB
                </div>
                <MdiButton
                    icon={mdiVolumeOff}
                    tooltip={mute ? "Un-Mute" : "Mute"}
                    buttonSize="small"
                    highlighted={mute}
                    onClick={this.toggleMute} />
                <MdiButton
                    icon={mdiVolumeMedium}
                    tooltip={dim ? "Un-Dim" : "Dim (-20dB)"}
                    buttonSize="small"
                    highlighted={dim}
                    enabled={(dim && volume <= (maxVol - 20)) || (!dim && volume >= (minVol + 20))}
                    onClick={this.toggleDim} />
            </>
        }>
            <VuMeterGroup
                title="IN"
                levels={capturesignalrms}
                peaks={capturesignalpeak}
                labels={this.props.inputLabels}
            />
            <input
                style={{ width: '100%', margin: 0, padding: 0 }}
                type="range"
                min={10.0 * minVol}
                max={10.0 * maxVol}
                value={10.0 * volume}
                id="volume"
                onChange={e => this.changeVolume(e.target.valueAsNumber / 10.0)}
            />
            <VuMeterGroup
                title="OUT"
                levels={playbacksignalrms}
                peaks={playbacksignalpeak}
                labels={this.props.outputLabels}
            />
        </Box>
    }
}
