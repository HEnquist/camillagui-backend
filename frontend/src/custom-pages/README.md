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

The current CamillaDSP configuration, read-only. `Config` in `../camilladsp/config` is generated
from camilladsp-config's own types (see [The API](#the-api)), so tsc knows every field, and your
editor shows them as you type. Every optional field is present, as `null` when it is not set.

```ts
config.devices.samplerate                  // number, e.g. 48000
config.devices.capture.type                // "Alsa", "CoreAudio", ...
config.devices.playback.channels           // output channel count
config.filters                             // keyed by filter name, null if there are none
config.mixers                              // keyed by mixer name, null if there are none
config.processors                          // keyed by processor name, null if there are none
config.pipeline                            // the steps in order, null if there are none
config.title, config.description           // string | null
```

Filters, processors and pipeline steps are unions on `type`, and the filter parameters on
`parameters.type` where a filter has subtypes, so checking those narrows the parameters:

```ts
const filter = config.filters?.["MyLowpass"]
if (filter?.type === "Biquad" && filter.parameters.type === "Lowpass") {
  console.log(filter.parameters.freq, filter.parameters.q)
}
```

### `updateConfig: (update: (config: Config) => void) => void`

Call this to modify the config. Pass a function that mutates the config in-place. The framework
deep-clones the config before calling your function, so you can mutate freely. Changes are pushed
to the undo/redo stack and marked as unapplied (the user must click Apply to send to the DSP).

```ts
// Change a filter's frequency
updateConfig((config) => {
  const filter = config.filters?.["MyLowpass"]
  if (filter?.type === "Biquad" && filter.parameters.type === "Lowpass") filter.parameters.freq = 1500
})

// Add a new filter, with every optional field, as null when it is not set
updateConfig((config) => {
  config.filters ??= {}
  config.filters["NewFilter"] = {
    type: "Biquad",
    description: null,
    parameters: { type: "Lowpass", freq: 1000, q: 0.707 }
  }
})

// Change a mixer mapping gain
updateConfig((config) => {
  const xover = config.mixers?.["xover"]
  if (xover) xover.mapping[0].sources[0].gain = -6
})

// Mute a channel
updateConfig((config) => {
  const xover = config.mixers?.["xover"]
  if (xover) xover.mapping[2].mute = true
})
```

### `guiConfig: GuiConfig`

Server-provided GUI settings (fetched from `/api/guiconfig`, all of them in `GuiConfig` in the
API schema). Useful fields:

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

## The API

Every endpoint is in the backend's OpenAPI spec, `rust/openapi.json` in the repository, also
served by a running backend at `/api/openapi.json`. Load it into any OpenAPI viewer to browse the
endpoints with their parameters, bodies and responses. The API is internal to the GUI and changes
between versions, so a custom page is checked against it at build time rather than relying on
this document.

`src/api/schema.ts` is generated from the spec, and the `api` client in `src/api/client.ts` takes
its types, so tsc checks the path, the parameters, the body and the response of every call. The
schemas are `Schemas` from the same file. The backend runs on port 5005 in production; in dev the
Vite proxy forwards `/api/*` automatically.

```ts
import { api, errorMessage, Schemas } from "../api/client"

// The config CamillaDSP runs, not the GUI's edited version
const { data: running } = await api.GET("/api/getconfig")

// Status values: capture rate, buffer level, processing load and so on
const { data: status } = await api.GET("/api/status")

// The main volume in dB, and setting it on the running DSP without changing the config
const { data: volume } = await api.GET("/api/param/volume")
await api.POST("/api/param/volume", { body: -10 })
await api.POST("/api/param/faders/{index}/mute", { params: { path: { index: 1 } }, body: true })

// The stored coefficient files
const { data: coeffs } = await api.GET("/api/files/{kind}", { params: { path: { kind: "coeff" } } })
const names = (coeffs ?? []).map((file) => file.name)

// Every issue with a config, none if it is valid
const { data: issues, error, response } = await api.POST("/api/validateconfig", { body: config })
if (error) console.log(errorMessage(error, response))
```

On failure `data` is undefined and `error` is an `ErrorBody` with a `message`.

### Event streams

A few endpoints are server-sent event streams, which OpenAPI cannot describe beyond their content
type. Their payloads are in the schema: `VuLevels`, `SpectrumData` and `StateUpdate`. Each open
stream is a subscription in CamillaDSP, so close it when the page no longer shows it.

```ts
import type { Schemas } from "../api/client"

const evtSource = new EventSource("/api/levels")
evtSource.addEventListener("levels", (e) => {
  const levels: Schemas["VuLevels"] = JSON.parse(e.data)
  // levels.playback_rms, levels.playback_peak: dBFS per channel, and the same for capture
})
// Remember to call evtSource.close() in useEffect cleanup
```

`GET /api/spectrum?side=playback&min_freq=20&max_freq=20000&n_bins=100&max_rate=10` is the same
for the spectrum, as `spectrum` events. Add `channel=0` for a single channel, leave it out to
average them all. It answers 503 while processing is stopped.

`GET /api/state` is the same for the processing state, as `state` events. The first event is the
current state, the next ones come when it changes. It answers 503, or ends, while CamillaDSP
cannot be reached.

## Evaluating a filter

Filter evaluation runs in the browser, not on the backend, so it is a plain function call rather
than an endpoint. Custom pages compile into the app, so they can import it directly.

```ts
import { evalFilter, evalFilterStep } from "../camilladsp/eval"

// The capture channel count, for $channels$ in coefficient file names. A WavFile capture has none.
const capture = config.devices.capture
const channels = "channels" in capture ? capture.channels : 2

const data = await evalFilter(config.filters!["MyFilter"], {
  name: "MyFilter",
  samplerate: config.devices.samplerate,
  channels,
})
// data.f: number[]            - frequency axis in Hz
// data.magnitude: number[]    - magnitude in dB at each frequency
// data.phase: number[]        - phase in degrees
// data.f_groupdelay: number[] - frequency axis for the group delay, the same as data.f
// data.groupdelay: number[]   - group delay in ms
// data.impulse: number[]      - the impulse response, Conv filters only

// The combined response of a whole pipeline step
const step = await evalFilterStep(config, 0, { samplerate: config.devices.samplerate, channels })
```

It returns a promise because a Conv filter reading a coefficient file has to ask the backend for
the coefficients. Everything else resolves without touching the network, so it is cheap enough to
call on every render.

## Adding a custom backend endpoint

Most custom pages will not need this — they work entirely with the existing API. But if you need
something the backend doesn't expose, you need to add an endpoint to the backend, in `rust/`.

1. Add a handler function in `rust/src/api.rs` (or a new module), with a `#[utoipa::path]`
   attribute describing it, like the handlers already there. Its request and response types
   derive `ToSchema`.
2. Register it with `.routes(routes!(api::my_handler))` in `api_routes` in `rust/src/main.rs`,
   which also puts it in the spec. The routes there are nested under `/api`.
3. The handler can call the running DSP through `app.camilla`, the `CamillaClient` in
   `rust/src/camilla.rs`. Filter evaluation runs in the browser, so import `evalFilter` from
   `camilladsp/eval` in the page itself rather than adding an endpoint for it.
4. Regenerate the spec and the frontend's types, so the page can call the endpoint through `api`:
   `UPDATE_OPENAPI=1 cargo test committed_spec_is_current` in `rust/`, then
   `npm run generate-api` in `frontend/`.
5. Rebuild the backend, `cargo build --release` in `rust/`.

## Available UI components

Import from `../utilities/ui-components`:

```tsx
import { Box, CheckBox, FloatInput, IntInput, EnumOption, MdiButton, ErrorBoundary }
  from "../utilities/ui-components"
```

| Component | Description |
|-----------|-------------|
| `Box` | Titled box container. `<Box title="Crossover">...</Box>` |
| `CheckBox` | Labelled checkbox. Props: `text`, `checked`, `tooltip`, `onChange` |
| `FloatInput` | Floating-point text field. Props: `value`, `onChange`, `tooltip` |
| `OptionalFloatInput` | Like FloatInput but allows null |
| `IntInput` | Integer text field |
| `FloatOption` | Label + FloatInput row. Props: `desc` (the label), `value`, `onChange`, `tooltip` |
| `IntOption` | Label + IntInput row |
| `BoolOption` | Label + CheckBox row |
| `EnumOption` | Label + `<select>` row. Props: `desc`, `value`, `options`, `onChange`, `tooltip` |
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
  const filters = Object.entries(config.filters ?? {})
  const mixerNames = Object.keys(config.mixers ?? {})
  const capture = config.devices.capture

  return (
    <div className="tabcontainer">
      <div className="tabpanel" style={{ width: "500px" }}>
        <Box title="Devices">
          <p>Samplerate: {config.devices.samplerate} Hz</p>
          <p>Capture channels: {"channels" in capture ? capture.channels : "N/A"}</p>
          <p>Playback channels: {config.devices.playback.channels}</p>
        </Box>
        <Box title={`Filters (${filters.length})`}>
          <ul>
            {filters.map(([name, filter]) => (
              <li key={name}>{name} — {filter.type}</li>
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
import type { Filter } from "../camilladsp/config"
import { Box, FloatOption } from "../utilities/ui-components"

const FILTER_NAME = "PeakingEQ_1"   // must exist in your config

/** The filter's parameters, if it is a peaking biquad. */
function peaking(filter: Filter | undefined) {
  if (filter?.type === "Biquad" && filter.parameters.type === "Peaking") return filter.parameters
}

function QuickEQ({ config, updateConfig }: CustomPageProps) {
  const params = peaking(config.filters?.[FILTER_NAME])
  if (!params) {
    return (
      <div className="tabcontainer">
        <p>There is no peaking filter "{FILTER_NAME}" in the config.</p>
      </div>
    )
  }

  return (
    <div className="tabcontainer">
      <div className="tabpanel" style={{ width: "400px" }}>
        <Box title={FILTER_NAME}>
          <FloatOption
            desc="Frequency (Hz)"
            value={params.freq}
            tooltip="Center frequency"
            onChange={(freq) => updateConfig((c) => {
              const p = peaking(c.filters?.[FILTER_NAME])
              if (p) p.freq = freq
            })}
          />
          <FloatOption
            desc="Gain (dB)"
            value={params.gain}
            tooltip="Boost or cut in dB"
            onChange={(gain) => updateConfig((c) => {
              const p = peaking(c.filters?.[FILTER_NAME])
              if (p) p.gain = gain
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
    const filter = config.filters?.[FILTER_NAME]
    if (!filter) return
    const capture = config.devices.capture
    evalFilter(filter, {
      name: FILTER_NAME,
      samplerate: config.devices.samplerate,
      channels: "channels" in capture ? capture.channels : 2,
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
- **Real-time values:** Use `EventSource("/api/levels")` for live level meters. Close the source
  in the `useEffect` cleanup to avoid leaks.
- **Narrowing instead of casts:** Check `filter.type`, and `filter.parameters.type` for a filter
  with subtypes, and tsc knows which parameters the filter has. A cast hides it from tsc when a
  new version of CamillaDSP changes them.
- **Imports:** All imports must be relative paths starting with `../` (e.g. `../utilities/...`,
  `../camilladsp/config`). Do not import from `./` except for `./types`.
