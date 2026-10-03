import React, { Component } from "react"
import { mdiAlertCircle, mdiCheck, mdiOpenInApp, mdiPlay } from "@mdi/js"
import { ColumnDef } from "@tanstack/react-table"
import { cloneDeep, isEqual } from "lodash"
import { CaptureDevice, Config, CURRENT_CONFIG_VERSION, Mixer, PlaybackDevice } from "./camilladsp/config"
import { DataTable, sortByRows } from "./utilities/data-table"
import {
  DeleteFilesButton,
  DownloadFilesAsZipButton,
  EMPTY_FILENAME,
  FileAction,
  FileStatus,
  FileStatusMessage,
  RenameButton,
  UploadFilesButton,
} from "./utilities/file-actions"
import { FileInfo, doUpload, download, downloadFromUrl, loadConfigJson, loadFiles } from "./utilities/files"
import { Box, ErrorBoundary, fileDateSort, fileNameSort, MdiButton } from "./utilities/ui-components"

const PLAYBACK_MIXER_NAME = "__file_playback_adapter__"

function isEligibleConfig(c: FileInfo): boolean {
  return c.valid === true && c.version === CURRENT_CONFIG_VERSION
}

export function FilePlayback(props: { loadConfig?: (config: Config) => void }) {
  return (
    <ErrorBoundary>
      <div className="tabcontainer">
        <div className="wide-tabpanel" style={{ width: "900px" }}>
          <WavFileTable loadConfig={props.loadConfig} />
        </div>
        <div className="tabspacer" />
      </div>
    </ErrorBoundary>
  )
}

class WavFileTable extends Component<
  { loadConfig?: (config: Config) => void },
  {
    files: FileInfo[]
    configs: FileInfo[]
    baseConfigName: string
    baseConfig: Config | null
    selectedFiles: FileInfo[]
    fileStatus: FileStatus | null
    filterText: string
  }
> {
  private timerId: ReturnType<typeof setInterval> | undefined
  private readonly handleVisibilityChange = () => {
    if (document.hidden) {
      this.stopPolling()
      return
    }
    this.startPolling()
    this.update()
  }

  constructor(props: { loadConfig?: (config: Config) => void }) {
    super(props)
    this.update = this.update.bind(this)
    this.upload = this.upload.bind(this)
    this.delete = this.delete.bind(this)
    this.downloadAsZip = this.downloadAsZip.bind(this)
    this.rename = this.rename.bind(this)
    this.play = this.play.bind(this)
    this.loadIntoGui = this.loadIntoGui.bind(this)
    this.setSelected = this.setSelected.bind(this)
    this.setBaseConfigName = this.setBaseConfigName.bind(this)
    this.state = {
      files: [],
      configs: [],
      baseConfigName: "",
      baseConfig: null,
      selectedFiles: [],
      fileStatus: null,
      filterText: "",
    }
  }

  private setBaseConfigName(name: string) {
    this.setState({ baseConfigName: name, baseConfig: null })
    if (name) {
      loadConfigJson(name)
        .then((config) => {
          // Only apply if the user hasn't switched away in the meantime
          if (this.state.baseConfigName === name) this.setState({ baseConfig: config })
        })
        .catch(() => {
          if (this.state.baseConfigName === name) this.setState({ baseConfig: null })
        })
    }
  }

  componentDidMount() {
    this.update()
    document.addEventListener("visibilitychange", this.handleVisibilityChange)
    this.startPolling()
  }

  componentWillUnmount() {
    document.removeEventListener("visibilitychange", this.handleVisibilityChange)
    this.stopPolling()
  }

  private startPolling() {
    if (document.hidden || this.timerId !== undefined) return
    this.timerId = setInterval(this.update, 10000)
  }

  private stopPolling() {
    if (this.timerId !== undefined) {
      clearInterval(this.timerId)
      this.timerId = undefined
    }
  }

  private update() {
    loadFiles("audiofile").then((files) => {
      if (!isEqual(files, this.state.files)) {
        this.setState({ files })
      }
    })
    loadFiles("config").then((configs) => {
      if (!isEqual(configs, this.state.configs)) {
        this.setState((prev) => {
          const stillEligible = configs.some((c) => c.name === prev.baseConfigName && isEligibleConfig(c))
          return {
            configs,
            baseConfigName: stillEligible ? prev.baseConfigName : "",
            baseConfig: stillEligible ? prev.baseConfig : null,
          }
        })
      }
    })
  }

  private showSuccess(filename: string, action: FileAction) {
    this.setState({ fileStatus: { filename, action, success: true } })
  }

  private showErrorMessage(filename: string, action: FileAction, statusText: string) {
    this.setState({
      fileStatus: { filename, action, success: false, statusText },
    })
  }

  private setSelected(selected: { allSelected: boolean; selectedCount: number; selectedRows: FileInfo[] }) {
    this.setState({ selectedFiles: selected.selectedRows })
  }

  private upload(files: FileList) {
    doUpload(
      "audiofile",
      files,
      () => {
        this.showSuccess(EMPTY_FILENAME, "upload")
        this.update()
      },
      (message) => this.showErrorMessage(EMPTY_FILENAME, "upload", message),
    )
  }

  private async delete() {
    const del = window.confirm("Delete?\n" + this.state.selectedFiles.map((f) => f.name).join("\n"))
    if (!del) return
    await fetch("/api/deleteaudiofiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.state.selectedFiles.map((f) => f.name)),
    })
    this.setState({ fileStatus: null })
    this.update()
  }

  private async downloadAsZip() {
    const response = await fetch("/api/downloadaudiofileszip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.state.selectedFiles.map((f) => f.name)),
    })
    const zipFile = await response.blob()
    download("audiofiles.zip", zipFile)
  }

  private async rename(filename: string) {
    const newName = window.prompt(`Enter a new name for ${filename}`, filename)
    if (newName === filename) return
    if (!newName) return
    try {
      const response = await fetch(
        `/api/renameaudiofile?source=${encodeURIComponent(filename)}&target=${encodeURIComponent(newName)}`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      )
      if (response.ok) {
        this.showSuccess(newName, "rename")
        this.update()
      } else {
        this.showErrorMessage(filename, "rename", await response.text())
      }
    } catch (e) {
      this.showErrorMessage(filename, "rename", (e as Error).message)
    }
  }

  private async loadIntoGui(wav: FileInfo) {
    const { baseConfigName } = this.state
    if (!baseConfigName) return
    if (wav.samplerate == null || wav.channels == null) {
      this.showErrorMessage(wav.name, "open", "Missing WAV header info")
      return
    }
    try {
      const baseConfig = await loadConfigJson(baseConfigName)
      const modified = buildPlaybackConfig(baseConfig, {
        filename: wav.name,
        samplerate: wav.samplerate,
        channels: wav.channels,
      })
      this.props.loadConfig?.(modified)
      this.showSuccess(wav.name, "open")
    } catch (e) {
      this.showErrorMessage(wav.name, "open", (e as Error).message)
    }
  }

  private async play(wav: FileInfo) {
    const { baseConfigName } = this.state
    if (!baseConfigName) return
    if (wav.samplerate == null || wav.channels == null) {
      this.showErrorMessage(wav.name, "play", "Missing WAV header info")
      return
    }
    try {
      const baseConfig = await loadConfigJson(baseConfigName)
      const modified = buildPlaybackConfig(baseConfig, {
        filename: wav.name,
        samplerate: wav.samplerate,
        channels: wav.channels,
      })
      const response = await fetch("/api/setconfig", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: null, config: modified }),
      })
      if (response.ok) {
        this.showSuccess(wav.name, "play")
      } else {
        this.showErrorMessage(wav.name, "play", await response.text())
      }
    } catch (e) {
      this.showErrorMessage(wav.name, "play", (e as Error).message)
    }
  }

  render() {
    const { files, configs, baseConfigName, baseConfig, selectedFiles, fileStatus, filterText } = this.state
    const eligibleConfigs = configs.filter(isEligibleConfig)
    const columns: ColumnDef<FileInfo, unknown>[] = [
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const isWav = row.original.name.toLowerCase().endsWith(".wav")
          const isValidWav = isWav && row.original.samplerate != null
          const wavDisabledReason =
            baseConfigName === ""
              ? "Select a base config first"
              : !isWav
                ? "Only WAV files support playback"
                : !isValidWav
                  ? "WAV file is invalid or unreadable"
                  : undefined
          return (
            <div style={{ display: "flex", flexDirection: "row" }}>
              <PlayButton
                filename={row.original.name}
                enabled={baseConfigName !== "" && isValidWav}
                disabledReason={wavDisabledReason}
                onClick={() => this.play(row.original)}
              />
              <LoadIntoGuiButton
                filename={row.original.name}
                fileStatus={fileStatus}
                enabled={baseConfigName !== "" && isValidWav && this.props.loadConfig != null}
                disabledReason={wavDisabledReason}
                onClick={() => this.loadIntoGui(row.original)}
              />
              <RenameButton
                filename={row.original.name}
                fileStatus={fileStatus}
                rename={() => this.rename(row.original.name)}
              />
            </div>
          )
        },
        enableSorting: false,
        meta: { compact: true, width: "112px" },
      },
      {
        id: "filename",
        header: "Filename",
        accessorFn: (row) => row.name,
        cell: ({ row }) => (
          <div style={{ overflow: "hidden" }}>
            <button
              type="button"
              className="file-link"
              data-tooltip-html={"Download " + row.original.name}
              data-tooltip-id="main-tooltip"
              onClick={() => {
                void downloadFromUrl(row.original.name, `/audiofiles/${encodeURIComponent(row.original.name)}`)
              }}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}
            >
              {row.original.name}
            </button>
            <FileStatusMessage filename={row.original.name} fileStatus={fileStatus} type="audiofile" />
          </div>
        ),
        sortingFn: sortByRows(fileNameSort),
        meta: { compact: true, width: "210px" },
      },
      {
        id: "duration",
        header: "Duration",
        accessorFn: (row) => row.duration ?? null,
        cell: ({ row }) => (row.original.duration != null ? formatDuration(row.original.duration) : ""),
        sortingFn: sortByRows((a, b) => (a.duration ?? -1) - (b.duration ?? -1)),
        meta: { width: "80px", compact: true, right: true },
      },
      {
        id: "samplerate",
        header: "Rate",
        accessorFn: (row) => row.samplerate ?? null,
        cell: ({ row }) => row.original.samplerate ?? "",
        sortingFn: sortByRows((a, b) => (a.samplerate ?? -1) - (b.samplerate ?? -1)),
        meta: { width: "80px", compact: true, right: true },
      },
      {
        id: "sampleformat",
        header: "Format",
        accessorFn: (row) => row.sampleformat ?? "",
        meta: { width: "80px", compact: true },
      },
      {
        id: "channels",
        header: "Ch",
        accessorFn: (row) => row.channels ?? null,
        cell: ({ row }) => row.original.channels ?? "",
        sortingFn: sortByRows((a, b) => (a.channels ?? -1) - (b.channels ?? -1)),
        meta: { width: "40px", compact: true, right: true },
      },
      {
        id: "date",
        header: "Date",
        accessorFn: (row) => row.formattedDate,
        sortingFn: sortByRows(fileDateSort),
        meta: { width: "110px", compact: true },
      },
    ]

    return (
      <Box title="WAV files">
        <div>
          <FileStatusMessage filename={EMPTY_FILENAME} fileStatus={fileStatus} type="audiofile" />
        </div>
        <label
          data-tooltip-html="Base config used when playing a WAV file.<br>Capture device is replaced with the WAV; the rest of the config is preserved."
          data-tooltip-id="main-tooltip"
          style={{ display: "block", margin: "4px 0 6px" }}
        >
          Base config:{" "}
          <select value={baseConfigName} onChange={(e) => this.setBaseConfigName(e.target.value)}>
            <option value="">(none)</option>
            {eligibleConfigs.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {baseConfig && <BaseConfigInfo config={baseConfig} />}
        <DataTable
          columns={columns}
          data={files}
          globalFilter={filterText}
          toolbar={
            <>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "8px" }}>
                <DownloadFilesAsZipButton
                  selectedFiles={selectedFiles.map((f) => f.name)}
                  downloadAsZip={this.downloadAsZip}
                />
                <DeleteFilesButton selectedFiles={selectedFiles.map((f) => f.name)} delete={this.delete} />
                <UploadFilesButton fileStatus={fileStatus} upload={this.upload} />
              </div>
              <input
                type="search"
                placeholder="Filter files"
                value={filterText}
                data-tooltip-html="Enter a search string to filter files"
                data-tooltip-id="main-tooltip"
                spellCheck="false"
                onChange={(e) => this.setState({ filterText: e.target.value })}
              />
            </>
          }
          selectableRows
          onSelectedRowsChange={this.setSelected}
          fixedLayout
        />
      </Box>
    )
  }
}

function PlayButton(props: { filename: string; enabled: boolean; disabledReason?: string; onClick: () => void }) {
  const { filename, enabled, disabledReason, onClick } = props
  return (
    <MdiButton
      icon={mdiPlay}
      enabled={enabled}
      tooltip={disabledReason ?? `Play ${filename} through the selected base config`}
      onClick={onClick}
    />
  )
}

function LoadIntoGuiButton(props: {
  filename: string
  fileStatus: FileStatus | null
  enabled: boolean
  disabledReason?: string
  onClick: () => void
}) {
  const { filename, fileStatus, enabled, disabledReason, onClick } = props
  let icon: { icon: string; className?: string } = { icon: mdiOpenInApp }
  if (fileStatus !== null && fileStatus.action === "open" && fileStatus.filename === filename) {
    icon = fileStatus.success
      ? { icon: mdiCheck, className: "success-text" }
      : { icon: mdiAlertCircle, className: "error-text" }
  }
  return (
    <MdiButton
      icon={icon.icon}
      className={icon.className}
      enabled={enabled}
      tooltip={disabledReason ?? "Load adapted config into the GUI editor"}
      onClick={onClick}
    />
  )
}

function BaseConfigInfo(props: { config: Config }) {
  const { config } = props
  const captureChannels =
    config.devices.capture.type === "WavFile" ? "from file" : String(config.devices.capture.channels)
  const playbackChannels = config.devices.playback.channels
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "max-content 1fr",
        columnGap: "12px",
        rowGap: "2px",
        margin: "6px 0 10px",
        fontSize: "0.9em",
      }}
    >
      {config.title && (
        <>
          <span style={{ fontWeight: "bold" }}>Title</span>
          <span>{config.title}</span>
        </>
      )}
      {config.description && (
        <>
          <span style={{ fontWeight: "bold" }}>Description</span>
          <span>{config.description}</span>
        </>
      )}
      <span style={{ fontWeight: "bold" }}>Sample rate</span>
      <span>{config.devices.samplerate} Hz</span>
      <span style={{ fontWeight: "bold" }}>Channels in / out</span>
      <span>
        {captureChannels} / {playbackChannels}
      </span>
      <span style={{ fontWeight: "bold" }}>Playback device</span>
      <span>{describePlaybackDevice(config.devices.playback)}</span>
    </div>
  )
}

function describePlaybackDevice(playback: PlaybackDevice): string {
  switch (playback.type) {
    case "PipeWire":
      return `PipeWire — ${playback.node_name ?? playback.node_description ?? "(default)"}`
    case "File":
      return `File — ${playback.filename}`
    case "Stdout":
      return "Stdout"
    default:
      return `${playback.type} — ${playback.device ?? "(default)"}`
  }
}

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return ""
  const total = Math.round(seconds * 10) / 10
  const mins = Math.floor(total / 60)
  const secs = total - mins * 60
  if (mins > 0) {
    return `${mins}:${secs.toFixed(1).padStart(4, "0")}`
  }
  return `${secs.toFixed(1)} s`
}

export function buildPlaybackConfig(
  base: Config,
  wav: { filename: string; samplerate: number; channels: number },
): Config {
  const config = cloneDeep(base)

  config.title = config.title ? `${config.title} — ${wav.filename}` : wav.filename

  // Capture device -> WavFile (bare filename; backend resolves against audiofiles_dir)
  config.devices.capture = {
    type: "WavFile",
    filename: wav.filename,
    extra_samples: null,
    labels: null,
  }

  // Resampling: file capture has no clock drift, so synchronous is enough
  if (wav.samplerate === config.devices.samplerate) {
    config.devices.resampler = null
    config.devices.capture_samplerate = null
  } else {
    config.devices.resampler = { type: "Synchronous" }
    config.devices.capture_samplerate = wav.samplerate
  }

  // Channel adapter: insert a mixer if the wav has a different channel count
  // than the original capture device. Wav fewer -> round-robin; wav more -> drop.
  const pipelineChannels = captureChannelCount(base.devices.capture, wav.channels)
  if (wav.channels !== pipelineChannels) {
    if (!config.mixers) config.mixers = {}
    config.mixers[PLAYBACK_MIXER_NAME] = makeAdapterMixer(wav.channels, pipelineChannels)
    if (!config.pipeline) config.pipeline = []
    config.pipeline = [
      { type: "Mixer", name: PLAYBACK_MIXER_NAME, description: null, bypassed: null },
      ...config.pipeline.filter((step) => !(step.type === "Mixer" && step.name === PLAYBACK_MIXER_NAME)),
    ]
  } else {
    // Equal channel count: drop a stale playback adapter if one is hanging around
    if (config.mixers) delete config.mixers[PLAYBACK_MIXER_NAME]
    if (config.pipeline) {
      config.pipeline = config.pipeline.filter((step) => !(step.type === "Mixer" && step.name === PLAYBACK_MIXER_NAME))
    }
  }

  return config
}

function captureChannelCount(capture: CaptureDevice, fallback: number): number {
  // All non-WavFile capture variants carry a `channels` field; WavFile reads it
  // from the file header at runtime, so we use the new wav's count as a sensible
  // default in that (uncommon) case.
  if (capture.type === "WavFile") return fallback
  return capture.channels
}

function makeAdapterMixer(inChannels: number, outChannels: number): Mixer {
  const mapping = []
  if (inChannels < outChannels) {
    // Round-robin: dest j <- src (j mod inChannels)
    for (let j = 0; j < outChannels; j++) {
      mapping.push({
        dest: j,
        sources: [{ channel: j % inChannels, gain: null, scale: null, inverted: null, mute: null }],
        mute: null,
      })
    }
  } else {
    // inChannels > outChannels: dest j <- src j; extras dropped
    for (let j = 0; j < outChannels; j++) {
      mapping.push({
        dest: j,
        sources: [{ channel: j, gain: null, scale: null, inverted: null, mute: null }],
        mute: null,
      })
    }
  }
  return {
    description: "Auto-inserted to adapt WAV channel count to pipeline",
    channels: { in: inChannels, out: outChannels },
    mapping,
    labels: null,
  }
}
