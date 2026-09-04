/**
 * Behaviour of the individual filter types.
 *
 * Ported from the backend's former `tests/test_filter_evaluation.py`, and
 * tightened where Python's tolerances were loose. These say what each filter is
 * supposed to do, in terms a reader can check against CamillaDSP's own filter
 * sources, rather than pinning a curve.
 */
import { describe, expect, it, vi } from "vitest"
import { Filter } from "../config"
import { magnitudeDb } from "./complex"
import { findPeak } from "./conv"
import { LOUDNESS_LOW_Q } from "./defaults"
import { complexGain } from "./filters"
import { clearCoefficientCache, evalFilter, evalFilterStep } from "./index"
import { FilterEvalError } from "./params"
import { unwrapPhase } from "./unwrap"

const FS = 48000

function filter(type: string, parameters: Filter["parameters"]): Filter {
  return { type, description: null, parameters }
}

/** Magnitude in dB at the given frequencies. */
function gainAt(f: Filter, freqs: number[], volume = 0.0): number[] {
  return magnitudeDb(complexGain(f, FS, volume, Float64Array.from(freqs)))
}

/** Two filters that must produce the same response, compared point by point. */
function expectSameResponse(a: Filter, b: Filter, volume = 0.0) {
  const freqs = [10, 50, 100, 500, 1000, 5000, 10000, 20000]
  const left = gainAt(a, freqs, volume)
  const right = gainAt(b, freqs, volume)
  left.forEach((value, n) => expect(value).toBeCloseTo(right[n], 12))
}

describe("shelving filters reach their gain at one end and unity at the other", () => {
  it("Lowshelf", () => {
    const [low, high] = gainAt(filter("Biquad", { type: "Lowshelf", freq: 1000.0, q: 0.707, gain: 6.0 }), [1, 20000])
    expect(low).toBeCloseTo(6.0, 3)
    expect(high).toBeCloseTo(0.0, 1)
  })

  it("Highshelf", () => {
    const [low, high] = gainAt(filter("Biquad", { type: "Highshelf", freq: 1000.0, q: 0.707, gain: 6.0 }), [1, 20000])
    expect(low).toBeCloseTo(0.0, 3)
    expect(high).toBeCloseTo(6.0, 1)
  })
})

describe("BiquadCombo", () => {
  it("a GraphicEqualizer with no gain anywhere is flat", () => {
    const gains = gainAt(
      filter("BiquadCombo", { type: "GraphicEqualizer", gains: [0.0, 0.0, 0.0, 0.0] }),
      [20, 200, 2000, 20000],
    )
    gains.forEach((gain) => expect(gain).toBeCloseTo(0.0, 12))
  })

  it("Tilt splits its gain evenly, low end down and high end up", () => {
    // the shelves sit at 110 Hz and 3500 Hz with a gentle Q of 0.35, so the
    // asymptotes are only reached well outside the audio band, and the top one
    // never quite arrives because the response is squeezed towards Nyquist
    const [low, high] = gainAt(filter("BiquadCombo", { type: "Tilt", gain: 8.0 }), [0.01, 23000])
    expect(low).toBeCloseTo(-4.0, 3)
    expect(high).toBeCloseTo(4.0, 2)
  })

  it("NPointPeq gives a band the role its position implies", () => {
    // Only one band has gain, so the others are left out entirely and the
    // combo must come out identical to that single biquad.
    const bands = (index: number) =>
      [0, 1, 2].map((n) => ({ freq: [100.0, 1000.0, 8000.0][n], q: 0.7, gain: n === index ? 5.0 : 0.0 }))
    const roles = ["Lowshelf", "Peaking", "Highshelf"]
    roles.forEach((role, index) => {
      expectSameResponse(
        filter("BiquadCombo", { type: "NPointPeq", bands: bands(index) }),
        filter("Biquad", { type: role, freq: [100.0, 1000.0, 8000.0][index], q: 0.7, gain: 5.0 }),
      )
    })
  })

  it("NPointPeq leaves out a band whose gain is below the minimum", () => {
    const withTinyBand = [
      { freq: 100.0, q: 0.7, gain: 4.0 },
      { freq: 1000.0, q: 1.0, gain: 0.0005 },
      { freq: 8000.0, q: 0.7, gain: -3.0 },
    ]
    const withoutIt = [withTinyBand[0], { freq: 1000.0, q: 1.0, gain: 0.0 }, withTinyBand[2]]
    expectSameResponse(
      filter("BiquadCombo", { type: "NPointPeq", bands: withTinyBand }),
      filter("BiquadCombo", { type: "NPointPeq", bands: withoutIt }),
    )
  })

  it("an NPointPeq with every band disabled is flat", () => {
    const bands = [100.0, 1000.0, 8000.0].map((freq) => ({ freq, q: 0.7, gain: 0.0 }))
    gainAt(filter("BiquadCombo", { type: "NPointPeq", bands }), [20, 1000, 20000]).forEach((gain) =>
      expect(gain).toBeCloseTo(0.0, 12),
    )
  })
})

describe("Loudness", () => {
  it("treats an explicit null as not set", () => {
    // The schema fills the optional parameters in as nulls, which must fall
    // back to CamillaDSP's defaults exactly like a missing key does.
    expectSameResponse(
      filter("Loudness", {
        reference_level: 0.0,
        high_freq: null,
        low_freq: null,
        high_q: null,
        low_q: null,
        high_boost: null,
        low_boost: null,
      }),
      filter("Loudness", { reference_level: 0.0 }),
      -20.0,
    )
  })

  it("uses a default Q equal to the fixed 12 dB/octave slope it replaced", () => {
    // Before high_q/low_q existed the shelves used a fixed slope. The default
    // Q has to reproduce it, or every existing config changes shape.
    for (const gain of [1.0, 5.0, 10.0, 20.0]) {
      expectSameResponse(
        filter("Biquad", { type: "Lowshelf", freq: 70.0, q: LOUDNESS_LOW_Q, gain }),
        filter("Biquad", { type: "Lowshelf", freq: 70.0, slope: 12.0, gain }),
      )
    }
  })

  it("boosts below the reference level and is flat above it", () => {
    const loudness = filter("Loudness", { reference_level: -20.0 })
    const boosted = gainAt(loudness, [20], -40.0)[0]
    const flat = gainAt(loudness, [20], 0.0)[0]
    expect(boosted).toBeGreaterThan(5.0)
    expect(flat).toBeCloseTo(0.0, 12)
  })
})

describe("Conv", () => {
  it("a single unity coefficient is flat, and comes back as the impulse response", async () => {
    const result = await evalFilter(filter("Conv", { type: "Values", values: [1.0] }), {
      samplerate: FS,
      channels: 2,
      npoints: 32,
    })
    result.magnitude!.forEach((gain) => expect(gain).toBeCloseTo(0.0, 12))
    // the impulse response stays in the typed array it arrives in
    expect(Array.from(result.impulse!)).toEqual([1.0])
    expect(Array.from(result.time)).toEqual([0.0])
  })

  it("finds the last of several equal peaks", () => {
    // A tie resolves to the highest index, which is what the delay removal in
    // the plot expects.
    expect(findPeak([0.0, 1.0, 0.0, 1.0, 0.0])).toBe(3)
    expect(findPeak([0.0, 0.5, 1.0, 0.5])).toBe(2)
    expect(findPeak([1.0, 0.0, -1.0])).toBe(2)
  })
})

describe("filter steps", () => {
  it("reports an unplottable filter instead of leaving it out of the step", async () => {
    const config = {
      devices: { samplerate: FS },
      filters: { odd: filter("SomethingElse", {}) },
      pipeline: [{ type: "Filter", channels: [0], names: ["odd"], description: null, bypassed: null }],
    }
    clearCoefficientCache()
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evalFilterStep(config as any, 0, { samplerate: FS, channels: 2, npoints: 16 }),
    ).rejects.toBeInstanceOf(FilterEvalError)
  })

  it("passes the flat types through without breaking the step", () => {
    for (const type of ["Volume", "Dither", "Clipper", "LookaheadLimiter"]) {
      gainAt(filter(type, {}), [20, 1000, 20000]).forEach((gain) => expect(gain).toBeCloseTo(0.0, 12))
    }
  })

  it("rejects a biquad subtype it does not know", () => {
    expect(() => gainAt(filter("Biquad", { type: "NotARealSubtype", freq: 1000.0, q: 1.0 }), [1000])).toThrow(
      FilterEvalError,
    )
  })
})

describe("phase unwrapping", () => {
  it("follows a slope steeper than 180 degrees per point", () => {
    // The predictive term is the whole reason this is not a plain unwrap: it
    // tracks a phase advancing well past 180 degrees per point, which a naive
    // one cannot do by construction.
    const truth: number[] = []
    let running = 0
    for (let n = 0; n < 600; n++) {
      running -= 1.0 + (299.0 * n) / 599
      truth.push(running)
    }
    const wrapped = truth.map((value) => ((((value + 180.0) % 360.0) + 360.0) % 360.0) - 180.0)

    const ours = unwrapPhase(wrapped, 270.0)
    const offset = ours[0] - truth[0]
    ours.forEach((value, n) => expect(Math.abs(value - offset - truth[n])).toBeLessThan(1.0))

    // a naive unwrap, comparing raw steps against half a turn, loses it as
    // soon as the slope passes 180 degrees per point
    const naive = [wrapped[0]]
    let turns = 0
    for (let n = 1; n < wrapped.length; n++) {
      const step = wrapped[n] - wrapped[n - 1]
      if (step > 180.0) turns -= 1
      else if (step < -180.0) turns += 1
      naive.push(wrapped[n] + 360.0 * turns)
    }
    const naiveOffset = naive[0] - truth[0]
    const naiveWorst = Math.max(...naive.map((value, n) => Math.abs(value - naiveOffset - truth[n])))
    expect(naiveWorst).toBeGreaterThan(1000.0)
  })
})

describe("demo and error paths", () => {
  it("surfaces a backend error rather than plotting nothing", async () => {
    clearCoefficientCache()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad format", { status: 400 })),
    )
    await expect(
      evalFilter(filter("Conv", { type: "Raw", filename: "broken.raw" }), {
        samplerate: FS,
        channels: 2,
        npoints: 16,
      }),
    ).rejects.toBeInstanceOf(FilterEvalError)
    vi.restoreAllMocks()
  })
})
