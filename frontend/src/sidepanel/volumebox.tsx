import React from "react"
import "../index.css"
import {VuMeterGroup} from "./vumeter"
import {Box, MdiButton} from "../utilities/ui-components"
import {mdiVolumeMedium, mdiVolumeOff} from "@mdi/js"

type Props = {
    capture_rms: any
    capture_peak: any
    playback_rms: any
    playback_peak: any
    clipped: boolean
    showLevelInDB: boolean
    setMessage: (message: string) => void
}

type State = {
    volume: number
    mute: boolean
    dim: boolean
}

const minVolume = -99

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
            this.setVolume(mute ? minVolume : volume)
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
        const props = this.props
        const {volume, mute, dim} = this.state
        return <Box title={
            <>
                Volume
                <div style={{display: 'inline-block', width: '5ch', textAlign: 'right', marginLeft: '5px'}}>
                    {mute ? '' : volume+'dB'}
                </div>
                <MdiButton
                    icon={mdiVolumeOff}
                    tooltip={mute ? "Un-Mute" : "Mute"}
                    smallButton={true}
                    className={mute ? "highlighted-button" : ""}
                    onClick={this.mute}/>
                <MdiButton
                    icon={mdiVolumeMedium}
                    tooltip={dim ? "Un-Dim" : "Dim (-20dB)"}
                    smallButton={true}
                    className={dim ? "highlighted-button" : ""}
                    enabled={dim || volume >= minVolume + 20}
                    onClick={this.dim}/>
            </>
        }>
            <VuMeterGroup
                title="In"
                level={props.capture_rms}
                peaks={props.capture_peak}
                clipped={props.clipped}
                showLevelInDB={this.props.showLevelInDB}
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
                level={props.playback_rms}
                peaks={props.playback_peak}
                clipped={props.clipped}
                showLevelInDB={this.props.showLevelInDB}
            />
        </Box>
    }
}
