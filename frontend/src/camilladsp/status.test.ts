import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  afterRestart,
  ControllerStatus,
  EventStreamManager,
  SpectrumSubscriptionParams,
  StartupArgs,
  StateEvent,
  Status,
  StatusPoller,
} from "./status"

describe("afterRestart", () => {
  const args: StartupArgs = {
    statefile: "/state.yml",
    config_file: null,
    no_config: false,
    wait: true,
    follow_capture: false,
    error_recovery: false,
    samplerate: null,
    channels: null,
    extra_samples: null,
    sample_format: null,
    volume: [null, null, null, null, null],
    mute: [false, false, false, false, false],
  }
  const running: ControllerStatus = {
    source: "Files",
    provider: "Single",
    config_file: "a.yml",
    startup_config_file: "a.yml",
    recovering: false,
    attempts: 0,
    next_retry_s: null,
    waiting_for_source: null,
    following: false,
    error_recovery: false,
    stop_reason: "None",
  }

  test("takes what the command line doesn't give from the statefile", () => {
    const after = afterRestart(running, { follow_capture: true, error_recovery: null }, args)
    expect(after.kept).toBe(true)
    expect(after.configFile).toEqual({ value: "a.yml", origin: "statefile", differs: false })
    // Enabled in the statefile, but the running session was started without following.
    expect(after.following).toEqual({ value: true, origin: "statefile", differs: true })
    expect(after.errorRecovery).toEqual({ value: false, origin: "statefile", differs: false })
    expect(after.overrides).toEqual([])
    expect(after.faders).toEqual([])
  })

  test("the command line wins over the statefile", () => {
    const after = afterRestart(
      { ...running, startup_config_file: "b.yml" },
      { follow_capture: null, error_recovery: null },
      {
        ...args,
        config_file: "a.yml",
        follow_capture: true,
        samplerate: 96000,
        volume: [-6, null, null, null, null],
        mute: [false, true, false, false, false],
      },
    )
    expect(after.configFile).toEqual({ value: "a.yml", origin: "command line", differs: false })
    expect(after.following).toEqual({ value: true, origin: "command line", differs: true })
    expect(after.overrides).toEqual(["--samplerate 96000"])
    expect(after.faders).toEqual(["Main: -6 dB", "Aux1: muted"])
  })

  test("without a statefile, nothing set while running is kept", () => {
    const after = afterRestart(
      { ...running, startup_config_file: "b.yml", config_file: "b.yml", error_recovery: true },
      { follow_capture: null, error_recovery: true },
      { ...args, statefile: null },
    )
    expect(after.kept).toBe(false)
    expect(after.configFile).toEqual({ value: null, origin: "default", differs: true })
    expect(after.errorRecovery).toEqual({ value: false, origin: "default", differs: true })
  })

  test("a config applied from the editor is gone after a restart", () => {
    const after = afterRestart({ ...running, source: "Websocket", provider: null, config_file: null }, null, args)
    expect(after.configFile.differs).toBe(true)
  })

  test("following and recovery need --wait", () => {
    const after = afterRestart(running, null, { ...args, wait: false, follow_capture: true })
    expect(after.wait).toBe(false)
    expect(after.following.value).toBe(false)
  })
})

/** Stands in for the browser's EventSource, so a test can push events and errors. */
class FakeEventSource extends EventTarget {
  static open: FakeEventSource[] = []
  url: string
  onerror: (() => void) | null = null
  closed = false

  constructor(url: string) {
    super()
    this.url = url
    FakeEventSource.open.push(this)
  }

  emit(name: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }))
  }

  fail() {
    this.onerror?.()
  }

  close() {
    this.closed = true
  }
}

/** The streams that are open, oldest first. */
function openStreams() {
  return FakeEventSource.open.filter((source) => !source.closed)
}

/** The one open stream. */
function stream() {
  const open = openStreams()
  expect(open).toHaveLength(1)
  return open[0]
}

/** Let the queued stream updates run. */
async function settle() {
  await vi.advanceTimersByTimeAsync(0)
}

const POLLED = {
  cdsp_online: true,
  cdsp_version: "5.0.0",
  backend_version: "5.0.0",
  capturerate: 48000,
  rateadjust: 1.0,
  bufferlevel: 1000,
  clippedsamples: 0,
  processingload: 1.5,
  resamplerload: 0.5,
  labels: { capture: null, playback: null },
  title: null,
  description: null,
}

const SPECTRUM: SpectrumSubscriptionParams = {
  side: "playback",
  channel: null,
  min_freq: 20,
  max_freq: 20000,
  n_bins: 100,
  max_rate: 10,
}

const LEVELS = { capture_rms: [-10], capture_peak: [-5], playback_rms: [-12], playback_peak: [-6] }

let polled: object

beforeEach(() => {
  vi.useFakeTimers()
  FakeEventSource.open = []
  vi.stubGlobal("EventSource", FakeEventSource)
  polled = POLLED
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(polled), {
          headers: { "Content-Type": "application/json" },
        }),
    ),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("StatusPoller", () => {
  let updates: Status[]
  let poller: StatusPoller

  beforeEach(async () => {
    updates = []
    poller = new StatusPoller((status) => updates.push(status), 500)
    await settle()
  })

  afterEach(async () => {
    poller.stop()
    await settle()
  })

  function latest() {
    return updates.at(-1)!
  }

  test("the state comes from the stream, the values from the poll", async () => {
    expect(stream().url).toBe("/api/events")
    stream().emit("state", { state: "Running" })
    // Nothing to show until the first poll.
    expect(updates).toEqual([])
    await vi.advanceTimersByTimeAsync(500)
    expect(latest().cdsp_status).toBe("Running")
    expect(latest().capturerate).toBe(48000)
    expect(latest()).not.toHaveProperty("cdsp_online")
    // A change shows at once, without waiting for a poll.
    stream().emit("state", { state: "Inactive", stop_reason: "Done" })
    expect(latest().cdsp_status).toBe("Inactive")
  })

  test("the state is offline while the stream is down", async () => {
    stream().emit("state", { state: "Running" })
    await vi.advanceTimersByTimeAsync(500)
    stream().fail()
    expect(latest().cdsp_status).toBe("Offline")
    // Reopened a second later, and the backend starts it with the current state.
    await vi.advanceTimersByTimeAsync(1000)
    stream().emit("state", { state: "Paused" })
    expect(latest().cdsp_status).toBe("Paused")
  })

  test("the state is offline when the backend cannot reach CamillaDSP", async () => {
    stream().emit("state", { state: "Running" })
    polled = { ...POLLED, cdsp_online: false }
    await vi.advanceTimersByTimeAsync(500)
    expect(latest().cdsp_status).toBe("Offline")
  })

  test("stopping closes the stream", async () => {
    const source = stream()
    poller.stop()
    await settle()
    expect(source.closed).toBe(true)
  })
})

describe("EventStreamManager", () => {
  let manager: EventStreamManager

  beforeEach(() => {
    manager = new EventStreamManager()
  })

  function query() {
    return new URL(stream().url, "http://localhost").searchParams
  }

  test("the wants combine into one stream", async () => {
    const drops = [
      manager.subscribeState(() => {}),
      manager.subscribeLevels(() => {}),
      manager.subscribeLevels(() => {}),
      manager.subscribeSpectrum(SPECTRUM, () => {}),
    ]
    await settle()
    expect(FakeEventSource.open).toHaveLength(1)
    expect(stream().url).toBe("/api/events?levels=true&side=playback&min_freq=20&max_freq=20000&n_bins=100&max_rate=10")
    drops.forEach((drop) => drop())
  })

  test("an unchanged combination does not reopen", async () => {
    manager.subscribeState(() => {})
    const dropLevels = manager.subscribeLevels(() => {})
    await settle()
    const source = stream()
    // As a re-render does.
    dropLevels()
    manager.subscribeLevels(() => {})
    await settle()
    expect(source.closed).toBe(false)
    expect(FakeEventSource.open).toHaveLength(1)
  })

  test("a changed combination reopens without losing the state", async () => {
    const states: (StateEvent | null)[] = []
    manager.subscribeState((state) => states.push(state))
    await settle()
    const first = stream()
    first.emit("state", { state: "Running" })
    const drop = manager.subscribeSpectrum(SPECTRUM, () => {})
    await settle()
    expect(first.closed).toBe(true)
    expect(query().get("side")).toBe("playback")
    drop()
    await settle()
    expect(query().has("side")).toBe(false)
    expect(states).toEqual([{ state: "Running" }])
  })

  test("the last want gone closes the stream", async () => {
    const dropState = manager.subscribeState(() => {})
    const dropLevels = manager.subscribeLevels(() => {})
    await settle()
    const source = stream()
    // The state is always in it, so the levels alone are the same stream.
    dropState()
    await settle()
    expect(stream()).toBe(source)
    dropLevels()
    await settle()
    expect(openStreams()).toEqual([])
  })

  test("a new state listener gets the last state at once", async () => {
    manager.subscribeState(() => {})
    await settle()
    stream().emit("state", { state: "Paused" })
    const states: (StateEvent | null)[] = []
    manager.subscribeState((state) => states.push(state))
    expect(states).toEqual([{ state: "Paused" }])
  })

  test("the levels go to every listener", async () => {
    const first: unknown[] = []
    const second: unknown[] = []
    manager.subscribeLevels((levels) => first.push(levels))
    manager.subscribeLevels((levels) => second.push(levels))
    await settle()
    stream().emit("levels", LEVELS)
    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
  })

  test("the last spectrum registered wins", async () => {
    const first: unknown[] = []
    const second: unknown[] = []
    manager.subscribeSpectrum(SPECTRUM, (data) => first.push(data))
    manager.subscribeSpectrum({ ...SPECTRUM, side: "capture" }, (data) => second.push(data))
    await settle()
    expect(query().get("side")).toBe("capture")
    stream().emit("spectrum", { frequencies: [100], magnitudes: [-20] })
    expect(first).toEqual([])
    expect(second).toHaveLength(1)
  })

  test("a quiet stream is reopened, unless heartbeats come", async () => {
    const states: (StateEvent | null)[] = []
    manager.subscribeState((state) => states.push(state))
    await settle()
    const source = stream()
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(2000)
      source.emit("heartbeat", {})
    }
    expect(source.closed).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(source.closed).toBe(true)
    expect(states).toEqual([null])
    expect(stream()).not.toBe(source)
  })

  test("the spectrum query leaves out null and omitted parameters", async () => {
    const queryOf = async (params: SpectrumSubscriptionParams) => {
      const drop = manager.subscribeSpectrum(params, () => {})
      await settle()
      const result = query()
      drop()
      await settle()
      return result
    }
    const omitted = await queryOf({ ...SPECTRUM, channel: undefined, max_rate: undefined })
    expect(omitted.has("channel")).toBe(false)
    expect(omitted.has("max_rate")).toBe(false)
    expect(omitted.get("n_bins")).toBe("100")
    const nulls = await queryOf({ ...SPECTRUM, channel: null, max_rate: null })
    expect(nulls.has("channel")).toBe(false)
    expect(nulls.has("max_rate")).toBe(false)
    const full = await queryOf({ ...SPECTRUM, channel: 0, max_rate: 10 })
    expect(full.get("channel")).toBe("0")
    expect(full.get("max_rate")).toBe("10")
  })
})
