/**
 * The plumbing around the evaluator rather than its numbers: the coefficient
 * cache, combining a whole pipeline step, and the samplerate and channel
 * options a step offers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { blankPhaseBelow, phaseNoiseFloor } from "./complex"
import {
  clearCoefficientCache,
  entriesToEvict,
  evalFilter,
  evalFilterStep,
  intersectFilterOptions,
  logspace,
} from "./index"
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

  /** A windowed sinc, whose stopband runs past -200 dB. */
  function windowedSinc(cutoff: number, highpass = false): Filter {
    const taps = 1001
    const centre = (taps - 1) / 2
    const fc = cutoff / 48000
    const values = Array.from({ length: taps }, (_, n) => {
      const k = n - centre
      const lowpass = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k)
      const value = highpass ? (k === 0 ? 1 : 0) - lowpass : lowpass
      const x = (2 * Math.PI * n) / (taps - 1)
      return value * (0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x))
    })
    return { type: "Conv", description: null, parameters: { type: "Values", values } }
  }

  it("reports the level it starts at, so the plot can offer to hide it", async () => {
    const result = await evalFilter(windowedSinc(1000.0), { samplerate: 48000, channels: 2 })
    const magnitude = result.magnitude!
    expect(result.phaseFloor).toBeCloseTo(Math.max(...magnitude) - 150, 9)
    expect(magnitude.filter((value) => value < result.phaseFloor!).length).toBeGreaterThan(50)
  })

  it("still delivers every point of the phase, hiding it being the plot's choice", async () => {
    const result = await evalFilter(windowedSinc(1000.0), { samplerate: 48000, channels: 2 })
    expect(result.phase!.every(Number.isFinite)).toBe(true)
    expect(result.magnitude!.every(Number.isFinite)).toBe(true)
    expect(Math.min(...result.magnitude!)).toBeLessThan(-200)
  })

  it("hides the group delay in the same places, so the two curves agree", async () => {
    // Cosmetic now, where it used to be the thing keeping the delay honest.
    // One value per plot frequency, so a gap is that point being too deep.
    const result = await evalFilter(windowedSinc(1000.0), { samplerate: 48000, channels: 2 })
    const blanked = result.groupdelay!.map((d, n) => n).filter((n) => !Number.isFinite(result.groupdelay![n]))
    expect(blanked.length).toBeGreaterThan(0)
    expect(result.f_groupdelay!.length).toBe(result.f.length)
    result.groupdelay!.forEach((delay, n) => {
      expect(Number.isFinite(delay)).toBe(result.magnitude![n] >= result.phaseFloor!)
    })
  })

  it("does not let the unreadable region move the group delay that is readable", async () => {
    // On a highpass the unreadable stretch sits below the passband. Reading the
    // delay off the phase meant carrying a prediction up through it, which
    // landed hundreds of ms out on the part anyone looks at.
    const result = await evalFilter(windowedSinc(1000.0, true), { samplerate: 48000, channels: 2 })
    const readable = result.groupdelay!.filter((d, n) => Number.isFinite(d) && result.magnitude![n] > -60)
    expect(readable.length).toBeGreaterThan(100)
    // a 1001 tap linear phase filter, plotted with its bulk delay removed
    readable.forEach((delay) => expect(Math.abs(delay)).toBeLessThan(1.0))
  })

  it("gives the same answer when the coefficients move in their last bit", async () => {
    // The regression test for what this replaced. The stopband of an FIR is a
    // run of nulls whose phase is aliasing hash, and the old prediction chain
    // walked through it, so which way each 180 degree step resolved decided the
    // passband delay. A relative 1e-16 on the coefficients, which is what a
    // different platform's sin and cos are worth, flipped it 8 times in 20 and
    // put a whole turn of the grid, 112 ms, into the readable part.
    // one ulp up or down, the smallest change a coefficient can have and still
    // be a different number
    let seed = 0x9e3779b9
    const jitter = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return 1.0 + Number.EPSILON * (seed % 3 === 0 ? -1 : seed % 3 === 1 ? 0 : 1)
    }
    for (let run = 0; run < 20; run++) {
      const base = windowedSinc(1000.0, true).parameters!.values as number[]
      const shaken: Filter = {
        type: "Conv",
        description: null,
        parameters: { type: "Values", values: base.map((v) => v * jitter()) },
      }
      clearCoefficientCache()
      const result = await evalFilter(shaken, { samplerate: 48000, channels: 2 })
      const readable = result.groupdelay!.filter((d, n) => Number.isFinite(d) && result.magnitude![n] > -60)
      expect(readable.length).toBeGreaterThan(100)
      readable.forEach((delay) => expect(Math.abs(delay)).toBeLessThan(1.0))
    }
  })

  it("has no floor for a filter evaluated in closed form, however far down it goes", async () => {
    const highpass: Filter = {
      type: "BiquadCombo",
      description: null,
      parameters: { type: "ButterworthHighpass", order: 4, freq: 1000.0 },
    }
    const result = await evalFilter(highpass, { samplerate: 48000, channels: 2 })
    expect(result.phaseFloor).toBeUndefined()
    expect(Math.min(...result.magnitude!)).toBeLessThan(-200)
    expect(result.phase!.every(Number.isFinite)).toBe(true)
    expect(result.groupdelay!.every(Number.isFinite)).toBe(true)
  })

  it("measures the floor from the curve's own peak", () => {
    expect(phaseNoiseFloor([40.0, -100.0, -120.0])).toBeCloseTo(-110.0, 9)
    const phase = [1.0, 2.0, 3.0]
    blankPhaseBelow(-110.0, [40.0, -100.0, -120.0], phase)
    expect(phase.map(Number.isFinite)).toEqual([true, true, false])
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
