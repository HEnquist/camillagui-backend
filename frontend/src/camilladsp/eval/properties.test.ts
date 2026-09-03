/**
 * Closed-form properties every filter must satisfy.
 *
 * These are the tests that trust neither implementation. Each one asserts
 * something that follows from what the filter *is* — a Butterworth is 3 dB
 * down at its cutoff whatever its order, an allpass passes every frequency at
 * unity, a delay of N samples has a group delay of N/fs — so they catch a
 * wrong coefficient without reference to any other code, and a genuine fix
 * makes them go green rather than red.
 *
 * The evaluator that was ported into this directory was never covered by
 * anything like this. It shipped with a Delay that read the pre-5.0 `unit`
 * key, so every non-millisecond delay was plotted as milliseconds; the group
 * delay test below fails outright on that bug.
 */
import { describe, expect, it } from "vitest"
import { Filter } from "../config"
import { magnitudeDb, phaseDegrees } from "./complex"
import { complexGain } from "./filters"
import { calcGroupDelay } from "./unwrap"

const FS = 48000

/** A wide log grid, deliberately not the one the plots use. */
const SWEEP = Array.from({ length: 400 }, (_, n) => 10.0 * Math.pow(10.0 ** (1 / 133), n))

function filter(type: string, parameters: Filter["parameters"]): Filter {
  return { type, description: null, parameters }
}

function gainAt(f: Filter, freqs: number[]): number[] {
  return magnitudeDb(complexGain(f, FS, 0.0, Float64Array.from(freqs)))
}

/** Group delay in ms across the sweep, from the same path the plots use. */
function groupDelay(f: Filter, freqs: number[]): number[] {
  const curve = complexGain(f, FS, 0.0, Float64Array.from(freqs))
  return calcGroupDelay(freqs, phaseDegrees(curve)).groupdelay
}

const HALF_POWER_DB = 20 * Math.log10(1 / Math.SQRT2)

describe("a notch is a true zero at its centre frequency", () => {
  it.each([500.0, 1000.0, 7000.0])("Notch at %d Hz", (freq) => {
    // The zero sits exactly on the unit circle, so the response there is not
    // merely small, it is zero to within the floor the plot adds.
    expect(gainAt(filter("Biquad", { type: "Notch", freq, q: 2.0 }), [freq])[0]).toBeLessThan(-200.0)
  })

  it("leaves everything well away from the notch alone", () => {
    const gains = gainAt(filter("Biquad", { type: "Notch", freq: 1000.0, q: 8.0 }), [20.0, 100.0, 10000.0, 20000.0])
    gains.forEach((gain) => expect(gain).toBeCloseTo(0.0, 2))
  })

  it("a bandpass is exactly unity at its centre frequency", () => {
    // The constant peak gain form, so the peak is 0 dB whatever the Q.
    for (const q of [0.5, 2.0, 8.0]) {
      expect(gainAt(filter("Biquad", { type: "Bandpass", freq: 1000.0, q }), [1000.0])[0]).toBeCloseTo(0.0, 9)
    }
  })
})

describe("an allpass passes every frequency at unity gain", () => {
  it.each(["Allpass", "AllpassFO"])("%s", (type) => {
    const params: Filter["parameters"] = { type, freq: 1200.0 }
    if (type === "Allpass") params.q = 1.5
    gainAt(filter("Biquad", params), SWEEP).forEach((gain) => expect(gain).toBeCloseTo(0.0, 9))
  })
})

describe("a peaking filter hits its gain exactly at the centre", () => {
  it.each([-12.0, -3.0, 3.0, 12.0])("gain %d dB", (gain) => {
    const freq = 1000.0
    expect(gainAt(filter("Biquad", { type: "Peaking", freq, q: 2.0, gain }), [freq])[0]).toBeCloseTo(gain, 9)
  })
})

describe("shelving filters reach exactly their gain at DC and Nyquist", () => {
  // Evaluated at the two points where the transfer function is real, so these
  // are exact rather than asymptotic.
  const DC = 0.0
  const NYQUIST = FS / 2

  it.each([-9.0, 4.5])("Lowshelf, gain %d dB", (gain) => {
    const f = filter("Biquad", { type: "Lowshelf", freq: 500.0, q: 0.707, gain })
    expect(gainAt(f, [DC])[0]).toBeCloseTo(gain, 9)
    expect(gainAt(f, [NYQUIST])[0]).toBeCloseTo(0.0, 9)
  })

  it.each([-9.0, 4.5])("Highshelf, gain %d dB", (gain) => {
    const f = filter("Biquad", { type: "Highshelf", freq: 500.0, q: 0.707, gain })
    expect(gainAt(f, [DC])[0]).toBeCloseTo(0.0, 9)
    expect(gainAt(f, [NYQUIST])[0]).toBeCloseTo(gain, 9)
  })

  it.each([-9.0, 4.5])("LowshelfFO, gain %d dB", (gain) => {
    const f = filter("Biquad", { type: "LowshelfFO", freq: 500.0, gain })
    expect(gainAt(f, [DC])[0]).toBeCloseTo(gain, 9)
    expect(gainAt(f, [NYQUIST])[0]).toBeCloseTo(0.0, 9)
  })

  it.each([-9.0, 4.5])("HighshelfFO, gain %d dB", (gain) => {
    const f = filter("Biquad", { type: "HighshelfFO", freq: 500.0, gain })
    expect(gainAt(f, [DC])[0]).toBeCloseTo(0.0, 9)
    expect(gainAt(f, [NYQUIST])[0]).toBeCloseTo(gain, 9)
  })
})

describe("lowpasses and highpasses pass and stop the right ends", () => {
  it("a first order lowpass is 3 dB down at its cutoff", () => {
    expect(gainAt(filter("Biquad", { type: "LowpassFO", freq: 1000.0 }), [1000.0])[0]).toBeCloseTo(HALF_POWER_DB, 6)
  })

  it("a first order highpass is 3 dB down at its cutoff", () => {
    expect(gainAt(filter("Biquad", { type: "HighpassFO", freq: 1000.0 }), [1000.0])[0]).toBeCloseTo(HALF_POWER_DB, 6)
  })

  it("a second order lowpass is Q at its cutoff", () => {
    // The magnitude of an RBJ lowpass at its own corner frequency is exactly Q.
    for (const q of [0.5, 0.707, 2.0]) {
      expect(gainAt(filter("Biquad", { type: "Lowpass", freq: 1000.0, q }), [1000.0])[0]).toBeCloseTo(
        20 * Math.log10(q),
        6,
      )
    }
  })
})

describe("Butterworth and Linkwitz-Riley crossovers", () => {
  // A Butterworth is 3 dB down at its cutoff for every order, and a
  // Linkwitz-Riley, being two of them in series, is 6 dB down.
  it.each([2, 3, 4, 5, 6, 7, 8])("a Butterworth of order %d is 3 dB down at its cutoff", (order) => {
    for (const type of ["ButterworthLowpass", "ButterworthHighpass"]) {
      expect(gainAt(filter("BiquadCombo", { type, order, freq: 1000.0 }), [1000.0])[0]).toBeCloseTo(HALF_POWER_DB, 6)
    }
  })

  it.each([2, 4, 6, 8])("a Linkwitz-Riley of order %d is 6 dB down at its crossover", (order) => {
    for (const type of ["LinkwitzRileyLowpass", "LinkwitzRileyHighpass"]) {
      expect(gainAt(filter("BiquadCombo", { type, order, freq: 1000.0 }), [1000.0])[0]).toBeCloseTo(
        2 * HALF_POWER_DB,
        6,
      )
    }
  })

  it.each([4, 8])("the two halves of a Linkwitz-Riley of order %d sum flat", (order) => {
    // This is the property the alignment exists for: the branches recombine to
    // an allpass, so their sum has unity magnitude at every frequency.
    const freqs = Float64Array.from(SWEEP)
    const low = complexGain(filter("BiquadCombo", { type: "LinkwitzRileyLowpass", order, freq: 1000.0 }), FS, 0, freqs)
    const high = complexGain(
      filter("BiquadCombo", { type: "LinkwitzRileyHighpass", order, freq: 1000.0 }),
      FS,
      0,
      freqs,
    )
    for (let n = 0; n < freqs.length; n++) {
      const magnitude = Math.hypot(low.re[n] + high.re[n], low.im[n] + high.im[n])
      expect(magnitude).toBeCloseTo(1.0, 9)
    }
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("a Butterworth of order %d has the Butterworth magnitude", (order) => {
    // |H|^2 = 1 / (1 + (f/f0)^2N) is what makes a filter a Butterworth. The
    // bilinear transform warps the frequency axis, and matches the analog
    // prototype at f0, so the comparison is made on the warped axis where the
    // property is exact rather than asymptotic.
    const freq = 500.0
    const warped = (f: number) => Math.tan((Math.PI * f) / FS) / Math.tan((Math.PI * freq) / FS)
    const freqs = [60.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0]

    const lowpass = gainAt(filter("BiquadCombo", { type: "ButterworthLowpass", order, freq }), freqs)
    lowpass.forEach((gain, n) => {
      expect(gain).toBeCloseTo(-10 * Math.log10(1 + warped(freqs[n]) ** (2 * order)), 6)
    })

    const highpass = gainAt(filter("BiquadCombo", { type: "ButterworthHighpass", order, freq }), freqs)
    highpass.forEach((gain, n) => {
      expect(gain).toBeCloseTo(-10 * Math.log10(1 + warped(freqs[n]) ** (-2 * order)), 6)
    })
  })
})

describe("a delay is a delay, in whichever unit it is given", () => {
  // 12 samples at 48 kHz is 0.25 ms, 250 us, 0.00025 s, and 85.75 mm of air.
  const TWELVE_SAMPLES_MS = (12 / FS) * 1000.0
  it.each([
    ["samples", 12.0],
    ["ms", TWELVE_SAMPLES_MS],
    ["us", TWELVE_SAMPLES_MS * 1000.0],
    ["s", TWELVE_SAMPLES_MS / 1000.0],
    ["mm", TWELVE_SAMPLES_MS * 343.0],
  ])("%s", (delay_unit, delay) => {
    const freqs = Array.from({ length: 200 }, (_, n) => 20.0 + n * 20.0)
    const delays = groupDelay(filter("Delay", { delay, delay_unit }), freqs)
    delays.forEach((value) => expect(value).toBeCloseTo(TWELVE_SAMPLES_MS, 9))
  })

  it("resolves a fractional delay with the subsample allpass", () => {
    // The allpass is accurate at low frequencies, which is where it is judged.
    const freqs = Array.from({ length: 40 }, (_, n) => 20.0 + n * 20.0)
    for (const samples of [0.5, 3.25, 7.75]) {
      const delays = groupDelay(filter("Delay", { delay: samples, delay_unit: "samples", subsample: true }), freqs)
      const expected = (samples / FS) * 1000.0
      delays.forEach((value) => expect(value).toBeCloseTo(expected, 3))
    }
  })

  it("has no effect at all when it is zero", () => {
    const freqs = [100.0, 1000.0, 10000.0]
    gainAt(filter("Delay", { delay: 0.0, delay_unit: "ms" }), freqs).forEach((gain) => expect(gain).toBeCloseTo(0, 12))
    phaseDegrees(
      complexGain(filter("Delay", { delay: 0.0, delay_unit: "ms" }), FS, 0, Float64Array.from(freqs)),
    ).forEach((phase) => expect(phase).toBe(0))
  })
})

describe("Gain", () => {
  it.each([-20.0, -6.0, 0.0, 6.0])("a dB gain of %d is flat at that level", (gain) => {
    gainAt(filter("Gain", { gain, scale: "dB" }), SWEEP).forEach((value) => expect(value).toBeCloseTo(gain, 9))
  })

  it("a linear gain of 0.5 is 6 dB down", () => {
    gainAt(filter("Gain", { gain: 0.5, scale: "linear" }), SWEEP).forEach((value) =>
      expect(value).toBeCloseTo(20 * Math.log10(0.5), 9),
    )
  })

  it("inverting flips the phase without touching the magnitude", () => {
    const freqs = Float64Array.from([100.0, 1000.0, 10000.0])
    const plain = complexGain(filter("Gain", { gain: -6.0 }), FS, 0, freqs)
    const inverted = complexGain(filter("Gain", { gain: -6.0, inverted: true }), FS, 0, freqs)
    magnitudeDb(plain).forEach((value, n) => expect(value).toBeCloseTo(magnitudeDb(inverted)[n], 12))
    phaseDegrees(inverted).forEach((phase) => expect(Math.abs(phase)).toBeCloseTo(180.0, 9))
  })
})

describe("Loudness", () => {
  it("scales its boost linearly with how far below the reference level it sits", () => {
    // Full boost at 20 dB below the reference, none at or above it, and half
    // way in between.
    const f = filter("Loudness", { reference_level: 0.0, low_boost: 10.0, high_boost: 10.0 })
    // read at DC, where the low shelf is exactly at its gain and the high
    // shelf exactly at unity
    const at = (volume: number) => magnitudeDb(complexGain(f, FS, volume, Float64Array.from([0.0])))[0]
    expect(at(0.0)).toBeCloseTo(0.0, 9)
    expect(at(-10.0)).toBeCloseTo(5.0, 9)
    expect(at(-20.0)).toBeCloseTo(10.0, 9)
    // clamped, not extrapolated
    expect(at(-40.0)).toBeCloseTo(10.0, 9)
  })
})
