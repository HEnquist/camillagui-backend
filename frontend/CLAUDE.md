# camillagui — React frontend

React 19 + TypeScript SPA built with Vite. Targets CamillaDSP 5.0.x.

## Dev commands (run from this directory)

```sh
npm run dev          # dev server on :5173, proxies /api -> :5005
npm run build        # TypeScript check + Vite build -> build/
npm run check        # tsc --noEmit only
npm test             # vitest (watch mode)
npm run lint         # eslint
npm run format       # prettier
```

Node >= 20.19.0 required (see `.nvmrc`).

## Source layout (`src/`)

```
index.tsx                   # App root — CamillaConfig class component, tab shell
guiconfig.ts                # GuiConfig type + defaults (fetched from /api/guiconfig)
index.css                   # All CSS (CSS variables in public/css-variables.css)

camilladsp/                 # Domain types + status polling
  config.ts                 # Config type, helpers (getCaptureDeviceChannelCount, etc.)
  status.ts                 # Status/state types
  usevumeterstatus.ts       # React hook for VU meter SSE stream
  versions.tsx              # Version mismatch UI

# Tab components (one per GUI tab)
titletab.tsx
devicestab.tsx
filterstab.tsx
mixerstab.tsx
processorstab.tsx
shortcuts.tsx
filestab.tsx

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
  arrays.ts                 # Array helpers
  chart.tsx                 # Chart.js wrapper
  data-table.tsx            # TanStack Table wrapper
  diffpopup.tsx             # JSON diff popup
  dragndrop.tsx             # React DnD helpers
  jsondiff.ts               # JSON patch (rfc6902) helpers
  styles.ts                 # Inline style helpers
```

## API

All requests go to `/api/*` (proxied to the backend in dev). See `camillagui-backend/backend/routes.py` for the full list.

Key endpoints used by the frontend:
- `GET /api/guiconfig` — GuiConfig JSON
- `GET /api/getconfig` — current CamillaDSP config as JSON
- `POST /api/setconfig` — push config to running DSP `{filename, config}`
- `POST /api/saveconfigfile` — save config to disk `{filename, config}`
- `GET /api/events` — SSE stream for status/level events
- `POST /api/evalfilter` / `POST /api/evalfilterstep` — filter frequency response

## Key patterns

- Config state lives in `CamillaConfig` (index.tsx) as an `UndoRedo<Config>` stack.
- `updateConfig(update: Update<Config>)` takes a mutating function and deep-clones state.
- Tabs are rendered with `react-tabs`; errors per-tab tracked via `Errors` (utilities/errors.ts).
- Icons: `@mdi/react` + `@mdi/js` constants.
- Charts: D3 for spectrum, Chart.js for filter plots.
