import React from "react"
import "../index.css"
import {VuMeterGroup} from "./vumeter"
import {Box, MdiButton} from "../utilities/ui-components"
import {mdiVolumeMedium, mdiVolumeOff} from "@mdi/js"
import {VuMeterStatus} from "../camilladsp/status"

type Props = {
    vuMeterStatus: VuMeterStatus
    setMessage: (message: string) => void
}

type State = {
    volume: number
    mute: boolean
    dim: boolean
}

const mutedVolume = -99
export const minVolume = -51

export class VolumeBox extends React.Component<Props, State> {

    constructor(props: Props) {
        super(props)
        this.mute = this.mute.bind(this)
        this.dim = this.dim.bind(this)
        this.state = {volume: 0, mute: false, dim: false}
        this.updateVolume()
    }

    private async updateVolume() {
        const vol_req = await fetch("/api/getparam/volume")
        let volume = 0
        try {
            if (vol_req.ok) {
                volume = parseInt(await vol_req.text(), 10)
                this.setState({volume: volume})
            }
        } catch (e) {}
    }

    componentDidUpdate(prevProps: Readonly<Props>, prevState: Readonly<State>, snapshot?: any) {
        const {volume, mute} = this.state
        if (volume !== prevState.volume || mute !== prevState.mute)
            this.setVolume(mute ? mutedVolume : volume)
    }

    private mute() {
        this.setState(({mute}) => ({mute: !mute}))
    }

    private dim() {
        this.setState(({volume, dim}) => ({
            volume: volume + (dim ? 20.0 : -20.0),
            dim: !dim
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

    render() {
        const {capturesignalrms, capturesignalpeak, playbacksignalpeak, playbacksignalrms, clipped}
            = this.props.vuMeterStatus
        const {volume, mute, dim} = this.state
        return <Box title={
            <>
                Volume
                <div className="db-label">
                    {mute ? '' : volume+'dB'}
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
                value={mute ? minVolume : volume}
                id="volume"
                onChange={e => this.setState({volume: e.target.valueAsNumber, mute: false, dim: false})}
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
