import React from "react";
import "./index.css";

export class VolumeSlider extends React.Component<{
    setMessage: (message: string) => void
}, {
    volume: string
}> {

    constructor(props: any) {
        super(props);
        this.state = {volume: '0'}
        this.updateVolume()
    }

    private async updateVolume() {
        const vol_req = await fetch("/api/getparam/volume")
        let volume = '0'
        try {
            if (vol_req.ok) {
                volume = parseInt(await vol_req.text(), 10).toString()
                this.setState({volume: volume})
            }
        } catch (e) {}
    }

    private async setVolume(value: string) {
        const vol_req = await fetch("/api/setparam/volume", {
            method: "POST",
            headers: {"Content-Type": "text/plain; charset=us-ascii"},
            body: value,
        })
        const message = await vol_req.text()
        this.setState({volume: value})
        this.props.setMessage(message)
    }

    render() {
        return <div className="split-20-80">
            <div>{this.state.volume}dB</div>
            <input
                style={{width: '100%', margin: 0, padding: 0}}
                type="range"
                min="-99"
                max="0"
                value={this.state.volume}
                id="volume"
                onChange={e => this.setVolume(e.target.value)}
            />
        </div>
    }
}
