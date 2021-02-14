import React from "react";
import "./index.css";

export function VolumeSlider(props: { volume: string, onChange: (volume: string) => void }) {
    return (
        <div className="split-20-80">
            <div>{props.volume}dB</div>
            <input
                style={{width: '100%', margin: 0, padding: 0}}
                type="range"
                min="-99"
                max="0"
                value={props.volume}
                id="volume"
                onChange={(e) => props.onChange(e.target.value)}
            />
        </div>
    )
}
