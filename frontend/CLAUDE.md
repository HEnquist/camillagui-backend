# frontend: React frontend of CamillaGUI

React 19 + TypeScript SPA built with Vite. Targets CamillaDSP 5.0.x. Lives in `frontend/` of the
camillagui-backend repository, next to the backend it talks to; it was a separate repository
(HEnquist/camillagui) until 5.0, and its history came along.

## Dev commands (run from this directory)

```sh
npm run dev          # dev server on :5173, proxies /api -> :5005
npm run build        # TypeScript check + Vite build -> build/
npm run check        # tsc --noEmit only
npm test             # vitest (watch mode)
npm run lint         # eslint
npm run format       # prettier
npm run generate-api # src/api/schema.ts from ../api/openapi.json
```

Node >= 22 required (see `.nvmrc`, and CI runs 24.x).

## Source layout (`src/`)

```
index.tsx                   # App root, CamillaConfig class component, tab shell
guiconfig.ts                # GuiConfig (generated) + defaults (fetched from /api/guiconfig)
index.css                   # All CSS (CSS variables in public/css-variables.css)

api/
  schema.ts                 # Generated from ../api/openapi.json, do not edit
  client.ts                 # openapi-fetch client on the generated paths

camilladsp/                 # Domain types + status polling
  config.ts                 # Config types (generated, see below), helpers
  status.ts                 # Status/state types
  usevumeterstatus.ts       # React hook for VU meter SSE stream
  versions.tsx              # Version mismatch UI
  eval/                     # Filter evaluation, see below
    index.ts                # evalFilter / evalFilterStep, and the Conv coefficient cache
    filters.ts              # Transfer function per filter type
    biquad.ts               # Biquad coefficients for all 17 subtypes
    conv.ts                 # FFT, peak search, polar interpolation, Conv group delay
    complex.ts              # Elementwise complex arithmetic over Float64Arrays
    groupdelay.ts           # Group delay from the coefficients, Re(G/H)
    unwrap.ts               # Phase unwrapping, for interpolating a Conv's phase
    defaults.ts             # CamillaDSP's defaults for optional parameters
    params.ts               # Narrowing helpers for the untyped parameter bag
    fixtures/variants.json  # every schema-valid filter config, see below

# Tab components (one per GUI tab)
titletab.tsx
devicestab.tsx
devicecapabilitiespopup.tsx # A device's capabilities, from the devices tab
filterstab.tsx
mixerstab.tsx
processorstab.tsx
shortcuts.tsx
filestab.tsx
playbacktab.tsx             # Playing an audio file through the pipeline

custom-pages/               # Extra tabs: a .tsx here is a tab, see its README.md

pipeline/
  pipelinetab.tsx           # Pipeline tab
  pipelineplotter.tsx       # SVG pipeline diagram

sidepanel/
  sidepanel.tsx             # Left panel with Save/Apply buttons, status
  volumebox.tsx             # Volume fader
  auxfaderbox.tsx           # Aux fader
  cdspstatebox.tsx          # DSP running/offline state badge
  vumeter.tsx               # VU meter bars
  logfileviewer.tsx         # Log file modal
  configcheckmessage.tsx    # Config error banner

compactview.tsx             # Alternate compact UI mode
dashboardview.tsx           # Dashboard view mode

spectrum.tsx                # Spectrum analyser (D3)
spectrumbox.tsx             # Spectrum analyser wrapper/container

import/
  configimport.ts           # Config import logic
  importpopup.tsx           # Import dialog UI

main/
  UndoRedo.ts               # Immutable undo/redo stack

demo/
  mockBackend.ts            # In-browser mock of /api/* for demo mode

utilities/
  ui-components.tsx         # MdiButton, MdiIcon, delayedExecutor, etc.
  common.ts                 # Update<T> type, misc helpers
  errors.ts                 # Errors type (per-path error tracking)
  files.tsx                 # File API helpers (loadStartupConfig, etc.)
  file-actions.tsx          # Upload, download, rename and delete buttons for the file tables
  arrays.ts                 # Array helpers
  chart.tsx                 # Chart.js wrapper
  data-table.tsx            # TanStack Table wrapper
  diffpopup.tsx             # JSON diff popup
  dragndrop.tsx             # React DnD helpers
  jsondiff.ts               # JSON patch (rfc6902) helpers
  styles.ts                 # Inline style helpers
```

## API

All requests go to `/api/*` (proxied to the backend in dev). The full list is the backend's
OpenAPI spec, `../api/openapi.json`.

`src/api/schema.ts` is generated from the spec by openapi-typescript. Call the API through `api`
in `src/api/client.ts` (openapi-fetch), so tsc checks the path, parameters, body and response.
The exceptions are the event streams (`EventSource`) and `/api/convcoeffs` (binary), which use
the generated payload types with their own code. The demo backend uses the same generated types.
Every error is a JSON `ErrorBody` with a `message`: use `errorMessage` after an `api` call and
`responseErrorMessage` after a plain `fetch`, both in `src/api/client.ts`.

The config types in `camilladsp/config.ts` are the generated ones from camilladsp-schema, wrapped
in `Complete<>`, since the backend sends every optional field (as null) and the GUI always writes
them all. The filter and processor editors and the evaluator handle parameters by name, so they
work on `LooseFilter` and `LooseProcessor`, which every `Filter` and `Processor` is. A config
that comes from the backend goes through `completeConfig`, which says so to tsc.

Key endpoints used by the frontend:
- `GET /api/guiconfig`: GuiConfig JSON
- `GET /api/getconfig`: current CamillaDSP config as JSON
- `POST /api/setconfig`: push config to running DSP `{config}`
- `POST /api/saveconfigfile`: save config to disk `{filename, config}`
- `POST /api/validateconfig`: the config's issues, `{path, message, severity}`, none if valid
- `GET` and `POST /api/param/volume` and `/api/param/mute`, `GET /api/param/faders`,
  `POST /api/param/faders/{index}/volume` and `.../mute`: the volume and the faders
- `GET /api/levels`: SSE stream of VU levels, CamillaDSP's VuLevels as they came
- `GET /api/spectrum?side=...&n_bins=...`: SSE stream of spectra, CamillaDSP's SpectrumData
- `GET /api/state`: SSE stream of the processing state, CamillaDSP's StateUpdate, starting with
  the current one. `StatusPoller` merges it into the polled `/api/status` as `cdsp_status`
- Each open stream is its own CamillaDSP subscription, which ends when the stream is closed
- `POST /api/convcoeffs`: coefficients of a Conv filter that reads a file
- `GET /api/files/{kind}`, and `POST .../upload`, `.../delete`, `.../rename` and `.../zip`: the
  config, coeff and audiofile folders, helpers in `utilities/files.tsx`
- `GET /api/devices/{direction}/{backend}` and `.../capabilities?device=...`, `GET /api/backends`
  (the devices CamillaDSP can use)

## Filter evaluation

Filter plots are computed here, not on the backend. `evalFilter(filter, {samplerate, channels,
volume})` and `evalFilterStep(config, index, ...)` return a `ChartContent`. They are async only
because a Conv reading a coefficient file has to ask the backend for the coefficients, through
`POST /api/convcoeffs`; everything else resolves without touching the network, cheaply enough to
run on every keystroke. Resolved coefficients are cached, keyed on the Conv parameters plus
samplerate and channels, so dragging a control next to a Conv does not refetch it. It is bounded by
total size rather than entry count, 64 MB, because a Values filter is a handful of bytes while a
room correction is megabytes. The cache cannot see a file being replaced under a name it already
holds, so anything that changes the coefficient files on the backend calls `clearCoefficientCache()`.

Coefficients arrive as raw floats rather than JSON, framed as a length-prefixed header and then the
samples, and are kept as a typed array view over those bytes. The backend sends float32 where the
source file holds no more than that, which halves the payload for the usual coefficient file and
loses nothing. See `unframeCoefficients`.

A convolution filter's `ChartContent` carries `phaseFloor`, the level more than 150 dB below its
peak where an FIR's nulls sit closer together than the plot can sample, so a drawn phase there is
aliasing rather than phase. The chart's toolbar offers an eye button, hiding on by default,
which appears only when the curve actually goes that deep and swaps between `mdiEyeOff` and
`mdiEye` to show which way it is set. The group delay is blanked in the same places, so the two
curves agree about where the filter stops being readable, but nothing depends on that any more.

**The group delay is not read off the phase.** It comes from the coefficients, as
`tau = Re(G/H)` where `G` is the transform of the coefficients weighted by their own index, which
is what `scipy.signal.group_delay` computes. Every frequency stands alone, so there is no unwrap,
no prediction carried up the grid, and no way for a point in the aliased region to move the
passband. A biquad is a ratio of two three tap polynomials and sums along a cascade; a Conv gets a
second FFT, of `n*h[n]`. What this replaced predicted each phase step from the one below it, which
worked until a stopband null resolved the other way: a change in the last bit of the coefficients,
which is what a different platform's `sin` and `cos` are worth, moved the readable delay of a
highpass by 112 ms in half of all runs. `eval.test.ts` pins that down by shaking the coefficients
by one ulp.

Four test files cover it:

- `properties.test.ts` is the one that matters. Every assertion is a closed-form property the
  filter must satisfy, checked against no other implementation: a Butterworth of any order has the
  Butterworth magnitude on the prewarped frequency axis, an allpass is unity everywhere, a peaking
  filter is exactly its gain at the centre, a Linkwitz-Riley's two halves sum flat, a delay of N
  samples has a group delay of N/fs, a Conv whose impulse sits at sample N delays by N/fs and
  flattens again once the bulk delay is removed. **Add to this file when you add a filter.** It
  fails on wrongness rather than on change, so fixing a bug turns it green.
- `filters.test.ts` covers the behaviour of each type: band roles, defaults, null handling, unknown
  types raising rather than being dropped.
- `variants.test.ts` evaluates a case for every filter type, subtype and optional parameter, from
  `fixtures/variants.json`. **The filter types are in Rust (camilladsp-schema) and the evaluator
  is in TypeScript**, so this is the only thing keeping them coupled. The fixture is edited by
  hand, and the backend's `api/src/filter_variants.rs` fails to compile or fails its tests when
  camilladsp-schema has something the fixture does not cover.
- `eval.test.ts` covers the plumbing rather than the numbers: the coefficient cache, combining a
  whole pipeline step, and the samplerate and channel options a step offers.

A fixture of curves captured from the Python evaluator gated the original port, then was dropped.
It only ever pinned what the GUI had been drawing, which nothing had verified against CamillaDSP,
so a genuine fix would have shown up as dozens of red cases in an unreadable 1.8 MB blob.

## Key patterns

- Config state lives in `CamillaConfig` (index.tsx) as an `UndoRedo<Config>` stack.
- `updateConfig(update: Update<Config>)` takes a mutating function and deep-clones state.
- Tabs are rendered with `react-tabs`; errors per-tab tracked via `Errors` (utilities/errors.ts).
- Icons: `@mdi/react` + `@mdi/js` constants.
- Charts: D3 for spectrum, Chart.js for filter plots.
