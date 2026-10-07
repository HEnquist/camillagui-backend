import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { Status, StatusPoller } from "./status"

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

function stateStream() {
  return FakeEventSource.open.filter((source) => source.url === "/api/state" && !source.closed).at(-1)!
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

let polled: object
let updates: Status[]
let poller: StatusPoller

beforeEach(() => {
  vi.useFakeTimers()
  FakeEventSource.open = []
  vi.stubGlobal("EventSource", FakeEventSource)
  polled = POLLED
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => polled })),
  )
  updates = []
  poller = new StatusPoller((status) => updates.push(status), 500)
})

afterEach(() => {
  poller.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function latest() {
  return updates.at(-1)!
}

test("the state comes from the stream, the values from the poll", async () => {
  stateStream().emit("state", { state: "Running" })
  // Nothing to show until the first poll.
  expect(updates).toEqual([])
  await vi.advanceTimersByTimeAsync(500)
  expect(latest().cdsp_status).toBe("Running")
  expect(latest().capturerate).toBe(48000)
  expect(latest()).not.toHaveProperty("cdsp_online")
  // A change shows at once, without waiting for a poll.
  stateStream().emit("state", { state: "Inactive", stop_reason: "Done" })
  expect(latest().cdsp_status).toBe("Inactive")
})

test("the state is offline while the stream is down", async () => {
  stateStream().emit("state", { state: "Running" })
  await vi.advanceTimersByTimeAsync(500)
  stateStream().fail()
  expect(latest().cdsp_status).toBe("Offline")
  // Reopened a second later, and the backend starts it with the current state.
  await vi.advanceTimersByTimeAsync(1000)
  stateStream().emit("state", { state: "Paused" })
  expect(latest().cdsp_status).toBe("Paused")
})

test("the state is offline when the backend cannot reach CamillaDSP", async () => {
  stateStream().emit("state", { state: "Running" })
  polled = { ...POLLED, cdsp_online: false }
  await vi.advanceTimersByTimeAsync(500)
  expect(latest().cdsp_status).toBe("Offline")
})

test("stopping closes the state stream", () => {
  const stream = stateStream()
  poller.stop()
  expect(stream.closed).toBe(true)
})
