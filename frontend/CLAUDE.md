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

areas.ts                    # The Control and Edit areas, and which one is shown

# Edit area tabs
titletab.tsx
devicestab.tsx
devicecapabilitiespopup.tsx # A device's capabilities, from the devices tab
filterstab.tsx
mixerstab.tsx
processorstab.tsx
editortoolbar.tsx           # Above the Edit tabs: undo, the file and saving, Apply and Compare, check

# Control area tabs
controltabs.tsx             # Overview (now, after a restart, spectrum) and Configs (what runs)
filestab.tsx                # The config and filter files available to CamillaDSP
shortcuts.tsx               # Shortcuts
playbacktab.tsx             # Playing an audio file through the pipeline

custom-pages/               # Extra Control tabs: a .tsx here is a tab, see its README.md

pipeline/
  pipelinetab.tsx           # Pipeline tab
  pipelineplotter.tsx       # SVG pipeline diagram

sidepanel/
  sidepanel.tsx             # Left panel: volume, CamillaDSP and controller status
  volumebox.tsx             # Volume fader
  auxfaderbox.tsx           # Aux fader
  cdspstatebox.tsx          # DSP running/offline state badge
  controllerbox.tsx         # The built-in controller's status, the controls are in its tab
  vumeter.tsx               # VU meter bars
  logfileviewer.tsx         # Log file modal
  configcheckmessage.tsx    # Config error banner

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
The exceptions are the event streams (`EventSource`), `/api/convcoeffs` (binary) and the zip
download (a form posted into a hidden frame, so the browser saves the zip as it arrives), which use
the generated payload types with their own code. The demo backend uses the same generated types,
and answers the zip form too.
Every error is a JSON `ErrorBody` with a `message`: use `errorMessage` after an `api` call and
`responseErrorMessage` after a plain `fetch`, both in `src/api/client.ts`.

The config types in `camilladsp/config.ts` are the generated ones from camilladsp-schema, wrapped
in `Complete<>`, since the backend sends every optional field (as null) and the GUI always writes
them all. The filter and processor editors and the evaluator handle parameters by name, so they
work on `LooseFilter` and `LooseProcessor`, which every `Filter` and `Processor` is. A config
that comes from the backend goes through `completeConfig`, which says so to tsc.

Key endpoints used by the frontend:
- `GET /api/guiconfig`: GuiConfig JSON
- `GET /api/getconfig`: current CamillaDSP config as JSON, with the file paths relative to the
  configured folders like every other config the GUI gets
- `POST /api/setconfig`: push config to running DSP `{config}`
- `POST /api/saveconfigfile`: save config to disk `{filename, config}`
- `POST /api/validateconfig`: the config's issues, `{path, message}`, none if valid
- `GET` and `POST /api/param/volume` and `/api/param/mute`, `GET /api/param/faders`,
  `POST /api/param/faders/{index}/volume` and `.../mute`: the volume and the faders
- `GET /api/events?levels=true&side=...&n_bins=...`: the one SSE stream of a browser tab, since
  a browser has six connections to the backend for all its tabs and each open stream holds one.
  It always has `state` events, CamillaDSP's StateUpdate, starting with the current one and
  ending when CamillaDSP goes away. `levels` (VuLevels) and `spectrum` (SpectrumData) come when
  the query asks, and a `heartbeat` every 2 s. The backend starts a refused or ended spectrum
  again when the state goes to Running. `EventStreamManager` in `camilladsp/status.ts` owns the
  stream: consumers register what they want (`StatusPoller`, `useVuMeterLevels`,
  `useSpectrumData`), and it opens the stream again with a new query when that changes.
  `StatusPoller` merges the state into the polled `/api/status` as `cdsp_status`
- `POST /api/convcoeffs`: coefficients of a Conv filter that reads a file
- `GET /api/files/{kind}`, and `POST .../upload`, `.../delete`, `.../rename` and `.../zip`: the
  config, coeff and audiofile folders, helpers in `utilities/files.tsx`. The listing reads the
  files for their details (a config is validated), cached by the backend until a file changes;
  `?details=false` lists only names, sizes and times, for callers that need just the names
- `GET /api/files/fingerprints`: a hash per folder that changes when a file in it is added,
  removed, renamed or rewritten, by anyone. `subscribeFileChanges` polls it every 2 s for all
  the file tables, which list a folder again only when its hash changed. A poll rather than an
  event stream, since a browser has six connections to the backend for all its tabs, and each
  open stream holds one
- `GET /api/devices/{direction}/{backend}` and `.../capabilities?device=...`, `GET /api/backends`
  (the devices CamillaDSP can use)
- `POST /api/runfromfiles`, `GET` and `POST /api/controller/settings`,
  `GET /api/controller/checkfiles`: the built-in controller of CamillaDSP 6.0, which follows the
  capture source format and recovers from device errors. Its status and settings come with
  `/api/status` as `controller` and `controller_settings`, null without one, and the command
  line CamillaDSP was started with as `startup_args`. The `SidePanel` passes them up when they
  change, for the Files tab and the Control area. While following, the
  config that runs is the active one adapted to the source format, see `getstartconfig`. A
  source at `samplerate` or one of the `alternate_samplerates` runs natively, any other rate is
  resampled to `samplerate`. `runfromfiles` stores the active file and, unless `follow` is null,
  whether to follow, then reloads. The settings endpoint only stores, it does not reload

## Editor and CamillaDSP

The GUI keeps the config editor apart from what CamillaDSP runs, in two areas with tabs of their
own, switched above the tabs: *Control*, for what CamillaDSP does and runs, and *Edit*, for the
config editor. Control is the default, and the area shown is kept in localStorage
(`areas.ts`). The logo sits at the right end of the area switch, and the side panel is the same in
both areas. The automatic save and apply are kept in `CamillaConfig`, not in the toolbar, so
they carry on while Control is shown, for example when a shortcut changes the config.
The old `?compactview` and `?dashboardview` bookmarks open Control, which is what a phone uses.
Below 1000 px the side panel is a drawer, opened from a status strip with the state, and the
areas and their tabs take the whole width.

The file CamillaDSP loads when it starts or reloads (`startup_config_file`) is the *startup
config*, in the GUI and in CamillaDSP alike. It used to be the "active config", a name that
confused people, and the GUI's own API, its code and the `on_set_active_config` and
`on_get_active_config` settings still say active.

- The editor is the Edit area: its toolbar and the tabs Title to Pipeline. One config, the file
  it belongs to, and in the toolbar undo, redo, Save, Revert, Save as (a prompt, which asks
  before it overwrites another file), New from the default or blank, Import, auto-save, then
  "Apply to DSP", "Load from DSP", "Compare with DSP", "Apply automatically" with whether
  CamillaDSP runs the editor's config, the config check and the last message. The toolbar is
  above the tabs rather than in the side panel, so the side panel fits a 13" screen and the
  toolbar stays in view.
- The Files tab, in Control, manages the files available to CamillaDSP: uploads, downloads,
  renames, deletes, comparing and plotting. Its Load puts a config into the editor and switches
  to Edit. It only marks the startup config (★), it does not change it, and it doesn't save the
  editor's config, which is the toolbar's job.
- CamillaDSP is the side panel's CamillaDSP and Controller boxes and the Control area. The
  CamillaDSP box shows its state and "Stop processing", the log file is on Overview. The
  Controller box only shows the *source* (file, with the provider, or file-less), the file that
  runs, following and recovery.
- The Control area has Overview, Configs, Files, Shortcuts, File playback and the custom pages.
  Overview has what runs now, what runs after a restart, the spectrum and the log file. Configs has the
  config files and the follow checkbox, the error recovery toggle, and the check of the
  startup config that following adapts. All of them apply at once, nothing is staged. "After a restart" (`afterRestart` in `camilladsp/status.ts`) takes each value from
  the command line when it is given there, since CamillaDSP applies those over the statefile at
  every start, and from the statefile otherwise. It marks what differs from what runs now. Where
  the command line sets the startup config, following or recovery, the controls for it say that
  a change lasts until a restart. "Running from" is the file the running config came from
  (`config_file`); the startup config is listed under it only when it differs, which is when
  the config runs file-less or the file was changed without a reload.
- CamillaDSP's config comes from one of two sources:
  - "Apply to DSP" sends the editor's config (`setconfig`). It runs *file-less*, exactly as
    sent: nothing follows the source, and recovery restarts it. `source` is `Websocket`.
  - A click on a file in Configs' "Config files" runs it from files (`runfromfiles` with
    `follow` null, keeping the follow setting): it becomes the startup config, CamillaDSP
    reloads, and the file is loaded into the editor, so that the shortcuts work on what runs.
    This is the way back from file-less too. ★ marks the startup config, the highlighted file
    is the one that runs from files. It is the only place that picks the file, so there is no
    staged picker next to a quick switch doing the same.
  - The follow checkbox applies at once: while running from files with `runfromfiles` on the
    startup config, which reloads. While file-less it only stores the setting, since a reload
    would drop the applied config.
  - "Apply automatically" only resends a config that already runs file-less, it never leaves
    files. Without a controller it applies after every change, as there are no files to leave.
- The editor meets CamillaDSP in those buttons, in "Load into editor" (`getstartconfig`, the
  same as at startup, so an adapted config is never loaded), and in "Open in editor" on a file
  name. When the source goes from file-less back to files, the GUI marks the editor's config as
  no longer running. While file-less `getstartconfig` answers `fileless` with no file name,
  since the applied config belongs to no file

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
