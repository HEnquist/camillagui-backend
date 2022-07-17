import React from "react"
import "../index.css"
import {VuMeterGroup} from "./vumeter"
import {Box, MdiButton} from "../utilities/ui-components"
import {mdiCardsPlayingClubMultiple, mdiVolumeMedium, mdiVolumeOff} from "@mdi/js"
import {VuMeterStatus, Volume, VolumePoller} from "../camilladsp/status"

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

export class VolumeBox extends React.Component<Props, State> {

    private volumePoller = new VolumePoller(cdspVolume => this.setState({volume: cdspVolume.volume, mute:cdspVolume.mute}), 500.0)

    constructor(props: Props) {
        super(props)
        this.mute = this.mute.bind(this)
        this.dim = this.dim.bind(this)
        this.state = {volume: -99, mute: false, dim: false, send_to_dsp: false}
        //this.updateVolume()
    }

    //private async updateVolume() {
    //    const vol_req = await fetch("/api/getparam/volume")
    //    let volume = 0
    //    try {
    //        if (vol_req.ok) {
    //            volume = parseInt(await vol_req.text(), 10)
    //            this.setState({volume: volume})
    //        }
    //    } catch (e) {}
    //}

    //private async volumeDragged(value: number) {
    //    const {volume, mute} = this.state
    //    if (volume != value)
    //        this.setVolume(value)
    //    this.setMute(mute)
    //    this.setState({volume: value})
    //}

    componentDidUpdate(prevProps: Readonly<Props>, prevState: Readonly<State>, snapshot?: any) {
        const {volume, mute, send_to_dsp} = this.state
        if (send_to_dsp) {
            if (volume !== prevState.volume)
                this.setVolume(volume)
            if (mute !== prevState.mute)
                this.setMute(mute)
            this.volumePoller.restart_interval()
            this.setState({send_to_dsp: false})
        }
    }

    componentWillUnmount() {
        this.volumePoller.stop()
      }

    private mute() {
        this.setState(({mute}) => ({mute: !mute, send_to_dsp: true}))
    }

    private dim() {
        this.setState(({volume, dim}) => ({
            volume: volume + (dim ? 20.0 : -20.0),
            dim: !dim,
            send_to_dsp: true
        }))
    }

    private async setVolume(value: number) {
        const vol_req = await fetch("/api/setparam/volume", {
            method: "POST",
            headers: {"Content-Type": "text/plain; charset=us-ascii"},
            body: value.toString(),
        })
        const message = await vol_req.text()
        this.props.setMessage(message)
    }

    private async setMute(value: boolean) {
        const mute_req = await fetch("/api/setparam/mute", {
            method: "POST",
            headers: {"Content-Type": "text/plain; charset=us-ascii"},
            body: value.toString(),
        })
        const message = await mute_req.text()
        this.props.setMessage(message)
    }

    render() {
        const {capturesignalrms, capturesignalpeak, playbacksignalpeak, playbacksignalrms, clipped}
            = this.props.vuMeterStatus
        const {volume, mute, dim} = this.state
        return <Box title={
            <>
                Volume
                <div className={mute ? "db-label-muted":"db-label"}>
                    {volume}dB
                </div>
                <MdiButton
                    icon={mdiVolumeOff}
                    tooltip={mute ? "Un-Mute" : "Mute"}
                    buttonSize="small"
                    className={mute ? "highlighted-button" : ""}
                    onClick={this.mute}/>
                <MdiButton
                    icon={mdiVolumeMedium}
                    tooltip={dim ? "Un-Dim" : "Dim (-20dB)"}
                    buttonSize="small"
                    className={dim ? "highlighted-button" : ""}
                    enabled={dim || volume >= minVolume + 20}
                    onClick={this.dim}/>
            </>
        }>
            <VuMeterGroup
                title="In"
                levels={capturesignalrms}
                peaks={capturesignalpeak}
                clipped={clipped}
            />
            <input
                style={{width: '100%', margin: 0, padding: 0}}
                type="range"
                min={minVolume}
                max="0"
                value={volume}
                //disabled={mute}
                id="volume"
                onChange={e => this.setState({volume: e.target.valueAsNumber, dim: false, send_to_dsp: true})}
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
