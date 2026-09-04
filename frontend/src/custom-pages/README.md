# Custom Pages

Drop a `.tsx` file in this directory and rebuild — it becomes a new tab in the GUI. This document
is a full reference for implementing a custom page from scratch.

## How it works

Vite discovers all `*.tsx` files in this directory at build time. Each file must export a React
component as the default export and a `tabLabel` string. No registration or config changes needed.

```
src/custom-pages/
  MyPage.tsx          ← your file goes here
  README.md           ← this file
  types.ts            ← CustomPageProps type (import from here)
```

## Required structure

Each file must have a single default export — the React component — with `tabLabel` and optionally
`enabled` attached as static properties. This keeps the file compatible with Vite's Fast Refresh.

| Property | Type | Description |
|----------|------|-------------|
| `MyPage.tabLabel` | `string` | The text shown on the tab button |
| `MyPage.enabled` | `boolean` (optional) | Set to `false` to disable without deleting the file. Defaults to `true`. |

```tsx
import React from "react"
import type { CustomPageProps } from "./types"

function MyPage({ config, updateConfig, guiConfig }: CustomPageProps) {
  return (
    <div className="tabcontainer">
      <div className="tabpanel">
        <p>Samplerate: {config.devices.samplerate} Hz</p>
      </div>
    </div>
  )
}

MyPage.tabLabel = "My Page"
MyPage.enabled = true   // set to false to disable without deleting the file

export default MyPage
```

## Props (CustomPageProps)

### `config: Config`

The current CamillaDSP configuration, read-only. Top-level structure:

```ts
config.devices.samplerate: number          // e.g. 48000
config.devices.capture.channels: number    // input channel count
config.devices.capture.type: string        // e.g. "Alsa", "CoreAudio"
config.devices.playback.channels: number   // output channel count
config.devices.playback.type: string

config.filters: Record<string, {           // keyed by filter name
  type: string                             // "Biquad", "BiquadCombo", "Gain", "Delay", "Conv", ...
  parameters: Record<string, unknown>      // depends on type — see below
}>

config.mixers: Record<string, {            // keyed by mixer name
  channels: { in: number; out: number }
  mapping: Array<{
    dest: number
    sources: Array<{ channel: number; gain: number; mute: boolean; inverted?: boolean }>
    mute: boolean
  }>
}>

config.processors: Record<string, {
  type: string
  parameters: Record<string, unknown>
}>

config.pipeline: Array<{
  type: "Filter" | "Mixer" | "Processor"
  name: string
  channels?: number[]    // for Filter steps: which channels this applies to
  bypassed?: boolean
}>

config.title: string | null
config.description: string | null
```

#### Common filter parameter shapes

```ts
// Biquad filters (Lowpass, Highpass, Peaking, Notch, Allpass, ...)
{ type: "Lowpass",  freq: number, q: number }
{ type: "Highpass", freq: number, q: number }
{ type: "Peaking",  freq: number, q: number, gain: number }
{ type: "Lowshelf", freq: number, slope: number, gain: number }
{ type: "Highshelf", freq: number, slope: number, gain: number }

// BiquadCombo (higher-order filters as a single definition)
{ type: "ButterworthLowpass",    order: number, freq: number }
{ type: "ButterworthHighpass",   order: number, freq: number }
{ type: "LinkwitzRileyLowpass",  order: number, freq: number }
{ type: "LinkwitzRileyHighpass", order: number, freq: number }

// Gain
{ gain: number, mute?: boolean, scale?: "dB" | "Linear" | "Linear2", inverted?: boolean }

// Delay
{ delay: number, delay_unit: "ms" | "us" | "s" | "mm" | "samples", subsample?: boolean }

// Conv (convolution / FIR)
{ type: "Raw" | "Wav" | "Values", filename?: string, values?: number[] }
```

### `updateConfig: (update: (config: Config) => void) => void`

Call this to modify the config. Pass a function that mutates the config in-place. The framework
deep-clones the config before calling your function, so you can mutate freely. Changes are pushed
to the undo/redo stack and marked as unapplied (the user must click Apply to send to the DSP).

```ts
// Change a filter's frequency
updateConfig((config) => {
  const params = config.filters["MyLowpass"].parameters as { freq: number }
  params.freq = 1500
})

// Add a new filter
updateConfig((config) => {
  config.filters["NewFilter"] = {
    type: "Biquad",
    parameters: { type: "Lowpass", freq: 1000, q: 0.707 }
  }
})

// Change a mixer mapping gain
updateConfig((config) => {
  config.mixers["xover"].mapping[0].sources[0].gain = -6
})

// Mute a channel
updateConfig((config) => {
  config.mixers["xover"].mapping[2].mute = true
})
```

### `guiConfig: GuiConfig`

Server-provided GUI settings (fetched from `/api/guiconfig`). Useful fields:

```ts
guiConfig.coeff_dir: string        // directory where coefficient files are stored
guiConfig.audiofiles_supported: boolean
guiConfig.volume_max: number       // maximum volume in dB (0 means 0 dBFS)
guiConfig.spectrum_min_freq: number
guiConfig.spectrum_max_freq: number
guiConfig.status_update_interval: number  // ms between status polls
```

### `errors: Errors`

Validation errors for the current config, if any. Usually not needed in custom pages, but you can
check whether specific config paths have errors:

```ts
errors.hasErrors()                          // any errors at all?
errors.hasErrorsFor("filters")              // errors under config.filters?
errors.hasErrorsFor("filters", "MyFilter")  // errors for that specific filter?
errors.messageFor("devices", "samplerate")  // error string or undefined
```

## Calling existing API endpoints

The backend runs on port 5005 in production; in dev the Vite proxy forwards `/api/*` automatically.
Use plain `fetch` — no library needed.

### GET endpoints (no body)

```ts
// Current active config from the DSP (not the GUI's edited version)
const res = await fetch("/api/getconfig")
const config = await res.json()

// Running status
const res = await fetch("/api/status")
const status = await res.json()
// status.cdsp_status: "Running" | "Paused" | "Inactive" | "Starting" | "Off"

// Live parameter value (e.g. current volume)
const res = await fetch("/api/getparam/volume.level")
const value = await res.json()  // number

// All stored config files
const res = await fetch("/api/storedconfigs")
const files: string[] = await res.json()

// All stored coefficient files
const res = await fetch("/api/storedcoeffs")
const files: string[] = await res.json()
```

### Evaluating a filter

Filter evaluation runs in the browser, not on the backend, so it is a plain function call rather
than an endpoint. Custom pages compile into the app, so they can import it directly.

```ts
import { evalFilter, evalFilterStep } from "../camilladsp/eval"

const data = await evalFilter(config.filters["MyFilter"], {
  name: "MyFilter",
  samplerate: config.devices.samplerate,
  channels: config.devices.capture.channels,
})
// data.f: number[]            - frequency axis in Hz
// data.magnitude: number[]    - magnitude in dB at each frequency
// data.phase: number[]        - phase in degrees
// data.f_groupdelay: number[] - frequency axis for the group delay, the same as data.f
// data.groupdelay: number[]   - group delay in ms
// data.impulse: number[]      - the impulse response, Conv filters only

// The combined response of a whole pipeline step
const step = await evalFilterStep(config, 0, {
  samplerate: config.devices.samplerate,
  channels: config.devices.capture.channels,
})
```

It returns a promise because a Conv filter reading a coefficient file has to ask the backend for
the coefficients. Everything else resolves without touching the network, so it is cheap enough to
call on every render.

### POST /api/setparam/{name}

Set a live parameter on the running DSP without changing the full config. Useful for real-time
controls like volume. The value is sent as the request body.

```ts
await fetch("/api/setparam/volume.level", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(-10),   // value as JSON
})
```

### POST /api/validateconfig

Validate a config object without applying it. Returns an error string or empty string.

```ts
const res = await fetch("/api/validateconfig", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(config),
})
const errorMessage = await res.text()  // "" means valid
```

### SSE: GET /api/events

Server-sent event stream for real-time level meters and state changes. Use this instead of
polling if you need live updates.

```ts
const evtSource = new EventSource("/api/events")
evtSource.addEventListener("levels", (e) => {
  const levels = JSON.parse(e.data)
  // levels.playback: number[]     — dBFS per channel
  // levels.capture: number[]
  // levels.cdsp_status: string
})
evtSource.addEventListener("state", (e) => {
  const state = JSON.parse(e.data)
})
// Remember to call evtSource.close() in useEffect cleanup
```

## Adding a custom backend endpoint

Most custom pages will not need this — they work entirely with the existing API. But if you need
to compute something the backend doesn't expose (like the crossover frequency response across all
channels at once), you need to add an endpoint to `camillagui-backend/`.

1. Add a handler function in `camillagui-backend/backend/routes.py` (or a new file imported
   there).
2. Register it with `app.router.add_get("/api/mycustom", my_handler)` in the `setup_routes`
   function in `routes.py`.
3. The backend can use `pycamilladsp` to call the running DSP, or `pycamilladsp_plot` to evaluate
   filters and mixers — both are already installed in the backend's virtual environment.

## Available UI components

Import from `../utilities/ui-components`:

```tsx
import { Box, CheckBox, FloatInput, IntInput, EnumOption, MdiButton, ErrorBoundary }
  from "../utilities/ui-components"
```

| Component | Description |
|-----------|-------------|
| `Box` | Titled box container. `<Box title="Crossover">...</Box>` |
| `CheckBox` | Labelled checkbox. Props: `label`, `value`, `tooltip`, `onChange` |
| `FloatInput` | Floating-point text field. Props: `value`, `onChange`, `tooltip` |
| `OptionalFloatInput` | Like FloatInput but allows null/undefined |
| `IntInput` | Integer text field |
| `FloatOption` | Label + FloatInput row. Props: `label`, `value`, `onChange`, `tooltip` |
| `IntOption` | Label + IntInput row |
| `BoolOption` | Label + CheckBox row |
| `EnumOption` | Label + `<select>` row. Props: `label`, `value`, `options`, `onChange` |
| `EnumInput` | `<select>` without label |
| `MdiButton` | Icon button. Props: `icon` (from `@mdi/js`), `tooltip`, `onClick`, `enabled` |
| `MdiIcon` | Icon display. Props: `icon`, `tooltip`, `style` |
| `ErrorBoundary` | Wraps content, shows an error message if a child throws |
| `ErrorMessage` | Inline red error text. Props: `message?: string` |
| `Button` | Standard button. Props: `text`, `onClick`, `enabled` |

### CSS layout classes

Wrap your page content like existing tabs do:

```tsx
<div className="tabcontainer">        {/* outer flex container */}
  <div className="tabpanel" style={{ width: "700px" }}>
    {/* your content here */}
  </div>
  <div className="tabspacer" />       {/* flexible right spacer */}
</div>
```

Use `className="textbox"` on text inputs to match the app's styling.

## Icons

Icons come from `@mdi/js`. Import the constant for the icon you want:

```tsx
import { mdiFilter, mdiSpeaker, mdiChartLine, mdiPlus, mdiDelete } from "@mdi/js"

<MdiButton icon={mdiFilter} tooltip="Filter" onClick={() => {}} />
```

Browse all available icons at https://materialdesignicons.com.

## Complete example — read-only config inspector

```tsx
import React from "react"
import type { CustomPageProps } from "./types"
import { Box } from "../utilities/ui-components"

function ConfigInfo({ config }: CustomPageProps) {
  const filterNames = Object.keys(config.filters)
  const mixerNames = Object.keys(config.mixers)

  return (
    <div className="tabcontainer">
      <div className="tabpanel" style={{ width: "500px" }}>
        <Box title="Devices">
          <p>Samplerate: {config.devices.samplerate} Hz</p>
          <p>Capture channels: {config.devices.capture.channels}</p>
          <p>Playback channels: {config.devices.playback.channels}</p>
        </Box>
        <Box title={`Filters (${filterNames.length})`}>
          <ul>
            {filterNames.map((name) => (
              <li key={name}>{name} — {config.filters[name].type}</li>
            ))}
          </ul>
        </Box>
        <Box title={`Mixers (${mixerNames.length})`}>
          <ul>
            {mixerNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </Box>
      </div>
      <div className="tabspacer" />
    </div>
  )
}

ConfigInfo.tabLabel = "Config Info"
export default ConfigInfo
```

## Example with config editing — adjust a filter frequency

```tsx
import React from "react"
import type { CustomPageProps } from "./types"
import { Box, FloatOption } from "../utilities/ui-components"

const FILTER_NAME = "PeakingEQ_1"   // must exist in your config

function QuickEQ({ config, updateConfig }: CustomPageProps) {
  const filter = config.filters[FILTER_NAME]
  if (!filter) {
    return (
      <div className="tabcontainer">
        <p>Filter "{FILTER_NAME}" not found in config.</p>
      </div>
    )
  }
  const params = filter.parameters as { freq: number; gain: number; q: number }

  return (
    <div className="tabcontainer">
      <div className="tabpanel" style={{ width: "400px" }}>
        <Box title={FILTER_NAME}>
          <FloatOption
            label="Frequency (Hz)"
            value={params.freq}
            tooltip="Center frequency"
            onChange={(freq) => updateConfig((c) => {
              ;(c.filters[FILTER_NAME].parameters as { freq: number }).freq = freq
            })}
          />
          <FloatOption
            label="Gain (dB)"
            value={params.gain}
            tooltip="Boost or cut in dB"
            onChange={(gain) => updateConfig((c) => {
              ;(c.filters[FILTER_NAME].parameters as { gain: number }).gain = gain
            })}
          />
        </Box>
      </div>
      <div className="tabspacer" />
    </div>
  )
}

QuickEQ.tabLabel = "Quick EQ"
export default QuickEQ
```

## Example with API call — show filter frequency response

```tsx
import React, { useEffect, useState } from "react"
import type { CustomPageProps } from "./types"
import { evalFilter } from "../camilladsp/eval"
import { Box } from "../utilities/ui-components"

const FILTER_NAME = "MyLowpass"

function FilterPlot({ config }: CustomPageProps) {
  const [magnitude, setMagnitude] = useState<number[] | null>(null)
  const [freqs, setFreqs] = useState<number[] | null>(null)

  useEffect(() => {
    const filter = config.filters[FILTER_NAME]
    if (!filter) return
    evalFilter(filter, {
      name: FILTER_NAME,
      samplerate: config.devices.samplerate,
      channels: config.devices.capture.channels,
    }).then((data) => {
      setFreqs(data.f)
      setMagnitude(data.magnitude ?? null)
    })
  }, [config])

  return (
    <div className="tabcontainer">
      <div className="tabpanel" style={{ width: "600px" }}>
        <Box title={`Frequency response — ${FILTER_NAME}`}>
          {magnitude && freqs ? (
            <pre style={{ fontSize: "11px" }}>
              {freqs.slice(0, 10).map((f, i) =>
                `${Math.round(f)} Hz: ${magnitude[i].toFixed(1)} dB\n`
              )}
              ...
            </pre>
          ) : (
            <p>Loading...</p>
          )}
        </Box>
      </div>
      <div className="tabspacer" />
    </div>
  )
}

FilterPlot.tabLabel = "Filter Plot"
export default FilterPlot
```

## Tips for complex custom pages

- **Conditional logic on config contents:** Read `config.mixers` to check for a mixer named
  `"xover"` before rendering crossover controls. Show a helpful message if the required structure
  isn't present.
- **Local state for UI:** Use `useState` freely for things like selected channel, expanded panels,
  or intermediate form values.
- **Derived data from the DSP:** Call `evalFilter` inside `useEffect` with `config` as a
  dependency. Re-evaluates automatically when the user edits filters elsewhere.
- **Real-time values:** Use `EventSource("/api/events")` for live level meters. Close the source
  in the `useEffect` cleanup to avoid leaks.
- **TypeScript casts:** Filter parameters are typed as `Record<string, unknown>`. Cast to a
  specific shape: `const p = filter.parameters as { freq: number; q: number }`.
- **Imports:** All imports must be relative paths starting with `../` (e.g. `../utilities/...`,
  `../camilladsp/config`). Do not import from `./` except for `./types`.
