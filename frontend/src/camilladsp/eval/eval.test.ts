/**
 * Behaviour around the evaluator that the golden fixture cannot cover: the
 * coefficient cache, combining a whole pipeline step, and the samplerate and
 * channel options a step offers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Config, defaultConfig, Filter } from "../config"
import { clearCoefficientCache, evalFilter, evalFilterStep, intersectFilterOptions, logspace } from "./index"

function convFilter(filename: string): Filter {
  return {
    type: "Conv",
    description: null,
    parameters: { type: "Raw", filename, format: "TEXT" },
  }
}

function gainFilter(gain: number): Filter {
  return { type: "Gain", description: null, parameters: { gain, scale: "dB" } }
}

function stubCoefficients(coefficients: number[] = [1.0, 0.0, 0.0, 0.0]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ options: [], coefficients })))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const filterOptions = { samplerate: 48000, channels: 2, npoints: 32 }

describe("logspace", () => {
  it("steps by the span divided by the point count, so it stops short of the maximum", () => {
    const values = logspace(1.0, 1000.0, 3)
    expect(values.length).toBe(3)
    expect(values[0]).toBeCloseTo(1.0, 12)
    expect(values[1]).toBeCloseTo(10.0, 12)
    expect(values[2]).toBeCloseTo(100.0, 12)
  })
})

describe("coefficient cache", () => {
  beforeEach(() => {
    clearCoefficientCache()
    vi.restoreAllMocks()
  })

  it("fetches a coefficient file once, however often the filter is evaluated", async () => {
    const fetchMock = stubCoefficients()
    const filter = convFilter("impulse.raw")
    await evalFilter(filter, filterOptions)
    await evalFilter(filter, filterOptions)
    await evalFilter(filter, filterOptions)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("refetches when the samplerate or the channel count changes", async () => {
    const fetchMock = stubCoefficients()
    const filter = convFilter("impulse_$samplerate$.raw")
    await evalFilter(filter, filterOptions)
    await evalFilter(filter, { ...filterOptions, samplerate: 96000 })
    await evalFilter(filter, { ...filterOptions, channels: 4 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("does not remember a failed fetch, so the filter can plot once the file appears", async () => {
    const fetchMock = vi.fn(async () => new Response("no such file", { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)
    const filter = convFilter("missing.raw")
    await expect(evalFilter(filter, filterOptions)).rejects.toThrow()
    await expect(evalFilter(filter, filterOptions)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not go to the backend for a Conv that carries its own values", async () => {
    const fetchMock = stubCoefficients()
    const filter: Filter = {
      type: "Conv",
      description: null,
      parameters: { type: "Values", values: [1.0, 0.5] },
    }
    await evalFilter(filter, filterOptions)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("filter step evaluation", () => {
  beforeEach(() => {
    clearCoefficientCache()
    vi.restoreAllMocks()
  })

  function configWithStep(filters: { [name: string]: Filter }): Config {
    const config = defaultConfig()
    config.filters = filters
    config.pipeline = [
      {
        type: "Filter",
        channels: [0],
        names: Object.keys(filters),
        description: null,
        bypassed: null,
      },
    ]
    return config
  }

  it("multiplies the responses of every filter in the step", async () => {
    const config = configWithStep({ first: gainFilter(-6.0), second: gainFilter(-4.0) })
    const result = await evalFilterStep(config, 0, filterOptions)
    for (const magnitude of result.magnitude!) expect(magnitude).toBeCloseTo(-10.0, 9)
  })

  it("fetches the coefficients of a Conv in the step exactly once", async () => {
    const fetchMock = stubCoefficients()
    const config = configWithStep({ conv: convFilter("impulse.raw"), gain: gainFilter(-6.0) })
    await evalFilterStep(config, 0, filterOptions)
    await evalFilterStep(config, 0, filterOptions)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("starts at 10 Hz, where a single filter plot starts at 1 Hz", async () => {
    const config = configWithStep({ gain: gainFilter(0.0) })
    const step = await evalFilterStep(config, 0, filterOptions)
    const single = await evalFilter(gainFilter(0.0), filterOptions)
    expect(step.f[0]).toBeCloseTo(10.0, 12)
    expect(single.f[0]).toBeCloseTo(1.0, 12)
  })
})

describe("filter step options", () => {
  it("keeps only the combinations every convolution filter can offer", () => {
    const options = intersectFilterOptions(
      [
        [
          { name: "a_44100.raw", samplerate: 44100 },
          { name: "a_48000.raw", samplerate: 48000 },
        ],
        [{ name: "b_48000.raw", samplerate: 48000 }],
      ],
      96000,
      2,
    )
    expect(options).toEqual([{ name: "48000 Hz - 2 Channels", samplerate: 48000, channels: 2 }])
  })

  it("fills in the step's own samplerate and channels for a filename without tokens", () => {
    const options = intersectFilterOptions([[{ name: "plain.raw" }]], 44100, 4)
    expect(options).toEqual([{ name: "44100 Hz - 4 Channels", samplerate: 44100, channels: 4 }])
  })

  it("has nothing to offer when a step contains no file backed convolution", () => {
    expect(intersectFilterOptions([], 48000, 2)).toEqual([])
  })
})
