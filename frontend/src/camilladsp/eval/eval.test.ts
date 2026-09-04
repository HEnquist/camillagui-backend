/**
 * The plumbing around the evaluator rather than its numbers: the coefficient
 * cache, combining a whole pipeline step, and the samplerate and channel
 * options a step offers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { blankNoisyPhase } from "./complex"
import {
  clearCoefficientCache,
  entriesToEvict,
  evalFilter,
  evalFilterStep,
  intersectFilterOptions,
  logspace,
} from "./index"
import { calcGroupDelay } from "./unwrap"
import { FilterOption } from "../../utilities/chart"
import { Config, defaultConfig, Filter } from "../config"

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

/** The framing the backend replies with: header length, header, padding, samples. */
export function frameCoefficients(
  coefficients: number[],
  format: "float32" | "float64" = "float64",
  options: FilterOption[] = [],
): ArrayBuffer {
  const header = new TextEncoder().encode(JSON.stringify({ options, format }))
  const start = 4 + header.length + ((8 - ((4 + header.length) % 8)) % 8)
  const width = format === "float32" ? 4 : 8
  const buffer = new ArrayBuffer(start + width * coefficients.length)
  new DataView(buffer).setUint32(0, header.length, true)
  new Uint8Array(buffer, 4, header.length).set(header)
  if (format === "float32") new Float32Array(buffer, start).set(coefficients)
  else new Float64Array(buffer, start).set(coefficients)
  return buffer
}

function stubCoefficients(coefficients: number[] = [1.0, 0.0, 0.0, 0.0]) {
  const fetchMock = vi.fn(async () => new Response(frameCoefficients(coefficients)))
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

  it.each([
    // sizes in least recently used order, budget, how many of the oldest go
    [[10, 10, 10], 100, 0],
    [[60, 60], 100, 1],
    [[60, 20, 20], 100, 0], // exactly the budget, nothing has to go
    [[70, 20, 20], 100, 1],
    [[90, 90, 90], 100, 2],
    // never the newest, even when it does not fit on its own
    [[200], 100, 0],
    [[10, 200], 100, 1],
    [[], 100, 0],
  ] as const)("evicts %j against a budget of %i", (sizes, budget, expected) => {
    expect(entriesToEvict([...sizes], budget)).toBe(expected)
  })

  it("keeps a dozen small entries, where a cap on the count would not", async () => {
    // the sizes differ by orders of magnitude, so counting entries is the wrong
    // bound: twelve short impulse responses are nothing at all
    const fetchMock = stubCoefficients([1.0, 0.0])
    for (let n = 0; n < 12; n++) await evalFilter(convFilter(`small${n}.raw`), filterOptions)
    expect(fetchMock).toHaveBeenCalledTimes(12)
    await evalFilter(convFilter("small0.raw"), filterOptions)
    expect(fetchMock).toHaveBeenCalledTimes(12)
  })

  it("keeps the entries it is still being asked for, not the ones fetched first", async () => {
    // Using an entry has to move it to the front, or the filter being edited
    // would be evicted as soon as enough others had been plotted after it.
    const fetchMock = stubCoefficients()
    const first = convFilter("first.raw")
    await evalFilter(first, filterOptions)
    for (let n = 0; n < 7; n++) await evalFilter(convFilter(`other${n}.raw`), filterOptions)
    await evalFilter(first, filterOptions)
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })

  it.each(["float32", "float64"] as const)("reads a %s reply", async (format) => {
    // the backend picks the width from what the source file can hold, so both
    // have to come back as usable coefficients
    const coefficients = [1.0, -0.5, 0.25, 0.0]
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(frameCoefficients(coefficients, format))),
    )
    const result = await evalFilter(convFilter("impulse.raw"), filterOptions)
    expect(Array.from(result.impulse!)).toEqual(coefficients)
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

describe("a phase too deep to be readable", () => {
  beforeEach(() => {
    clearCoefficientCache()
    vi.restoreAllMocks()
  })

  /** A 1001 tap windowed sinc lowpass, whose stopband runs past -200 dB. */
  function sincLowpass(cutoff: number): Filter {
    const taps = 1001
    const centre = (taps - 1) / 2
    const fc = cutoff / 48000
    const values = Array.from({ length: taps }, (_, n) => {
      const k = n - centre
      const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k)
      return sinc * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1)))
    })
    return { type: "Conv", description: null, parameters: { type: "Values", values } }
  }

  it("is left out of an FIR's deep stopband, along with its group delay", async () => {
    const result = await evalFilter(sincLowpass(1000.0), { samplerate: 48000, channels: 2 })
    const magnitude = result.magnitude!
    const floor = Math.max(...magnitude) - 150
    const blanked = result.phase!.map((p, i) => [p, i] as const).filter(([p]) => !Number.isFinite(p))
    expect(blanked.length).toBeGreaterThan(50)
    // nothing is hidden that is not far below everything else on the plot
    blanked.forEach(([, i]) => expect(magnitude[i]).toBeLessThan(floor))
    expect(result.groupdelay!.some((d) => !Number.isFinite(d))).toBe(true)
  })

  it("keeps the magnitude, which is smooth where the phase is hash", async () => {
    const result = await evalFilter(sincLowpass(1000.0), { samplerate: 48000, channels: 2 })
    expect(Math.min(...result.magnitude!)).toBeLessThan(-200)
    expect(result.magnitude!.every(Number.isFinite)).toBe(true)
  })

  it("keeps every point of the phase that is above the floor", async () => {
    const result = await evalFilter(sincLowpass(1000.0), { samplerate: 48000, channels: 2 })
    const magnitude = result.magnitude!
    const floor = Math.max(...magnitude) - 150
    result.phase!.forEach((p, i) => {
      if (magnitude[i] >= floor) expect(Number.isFinite(p)).toBe(true)
    })
  })

  it("is measured from the curve's own peak", () => {
    const magnitude = [40.0, -100.0, -120.0]
    const phase = [1.0, 2.0, 3.0]
    blankNoisyPhase(magnitude, phase)
    // 40 dB peak, so the floor is at -110 dB
    expect(phase.map(Number.isFinite)).toEqual([true, true, false])
  })

  it("takes the group delay with it, rather than reading one off noise", () => {
    const freq = [100.0, 200.0, 300.0, 400.0]
    const phase = [0.0, -10.0, NaN, -30.0]
    const result = calcGroupDelay(freq, phase)
    expect(result.groupdelay.map(Number.isFinite)).toEqual([true, false, false])
  })

  it("does not let a blanked stretch teach the prediction anything", () => {
    // A constant 7 ms delay on the grid the plots use, with a hole blanked out
    // of the middle of it. By the top of the grid the phase is turning through
    // three whole circles between neighbouring points, so the points after the
    // hole are only right if the prediction picked up where it left off rather
    // than learning from the hole.
    const freq = Array.from(logspace(10.0, 22800.0, 1000))
    const phase = freq.map((f) => {
      const wrapped = (((-360.0 * f * 0.007 + 180.0) % 360.0) + 360.0) % 360.0
      return wrapped - 180.0
    })
    for (let n = 600; n < 640; n++) phase[n] = NaN
    const result = calcGroupDelay(freq, phase)
    result.groupdelay.forEach((delay, n) => {
      if (Number.isFinite(delay)) expect(delay).toBeCloseTo(7.0, 9)
      else expect(n).toBeGreaterThanOrEqual(599)
    })
    expect(result.groupdelay.slice(645).every((d) => Math.abs(d - 7.0) < 1e-9)).toBe(true)
  })

  it("leaves a filter evaluated in closed form alone, however far down it goes", async () => {
    // a 4th order highpass at 1 kHz really is 240 dB down at 1 Hz, deeper than
    // anything blanked above, and its phase there is smooth and readable: no
    // nulls to rotate through, so nothing for the grid to alias
    const highpass: Filter = {
      type: "BiquadCombo",
      description: null,
      parameters: { type: "ButterworthHighpass", order: 4, freq: 1000.0 },
    }
    const result = await evalFilter(highpass, { samplerate: 48000, channels: 2 })
    expect(Math.min(...result.magnitude!)).toBeLessThan(-200)
    expect(result.phase!.every(Number.isFinite)).toBe(true)
    expect(result.groupdelay!.every(Number.isFinite)).toBe(true)
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
