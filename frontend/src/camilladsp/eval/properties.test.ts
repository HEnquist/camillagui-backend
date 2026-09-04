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
import { magnitudeDb, multiplyInto, phaseDegrees } from "./complex"
import { convComplexGain, convGroupDelay } from "./conv"
import { complexGain, groupDelaySamples } from "./filters"
import { delayInMs } from "./groupdelay"
import { logspace } from "./index"

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
  return delayInMs(groupDelaySamples(f, FS, 0.0, Float64Array.from(freqs)), FS)
}

const HALF_POWER_DB = 20 * Math.log10(1 / Math.SQRT2)

describe("a notch is a true zero at its centre frequency", () => {
  it.each([500.0, 1000.0, 7000.0])("Notch at %d Hz", (freq) => {
    // The zero sits exactly on the unit circle, so the response there is not
    // merely small, it is zero to within the floor the plot adds.
    expect(gainAt(filter("Biquad", { type: "Notch", freq, q: 2.0 }), [freq])[0]).toBeLessThan(-200.0)
  })

  it("does not let its singular group delay spoil the rest of the curve", () => {
    // The zero sits on the unit circle, so the group delay there is genuinely
    // singular and whatever lands on that one point is arbitrary. What must not
    // happen is the rest of the curve following it: predicting each phase step
    // from a single wild neighbour would put a whole turn into every point
    // after it, and the curve would never come back.
    const freqs = Array.from(logspace(10.0, (0.95 * FS) / 2, 1000))
    const delays = groupDelay(filter("Biquad", { type: "Notch", freq: 1000.0, q: 2.0 }), freqs)
    const above = delays.filter((_, n) => freqs[n] > 5000.0)
    above.forEach((delay) => expect(Math.abs(delay)).toBeLessThan(0.01))
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

  it.each([10.0, 50.0, 200.0, 1000.0])("is exact at %d ms, however fast the phase turns", (ms) => {
    // On the log grid the plots use, the step at 20 kHz is over 150 Hz, so a
    // delay of 50 ms turns the phase through more than 20 whole circles from
    // one point to the next. Group delay is read off the phase step directly,
    // predicting each step from the delay just below it in frequency, so a
    // constant delay comes out exact whatever its size.
    const freqs = Array.from(logspace(10.0, (0.95 * FS) / 2, 1000))
    groupDelay(filter("Delay", { delay: ms, delay_unit: "ms" }), freqs).forEach((delay) =>
      expect(delay).toBeCloseTo(ms, 9),
    )
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

describe("group delay comes from the coefficients, not from the phase", () => {
  /**
   * The delay in ms at one frequency, from the slope of the phase either side
   * of it. The check the exact formula has to answer to: differentiating the
   * phase by hand is what group delay means, and on a fine linear grid, well
   * away from any null, doing it numerically is accurate enough to pin the
   * closed form to several digits.
   */
  function slopeOfPhase(f: Filter, freq: number): number {
    const h = 0.05
    const [below, above] = phaseDegrees(complexGain(f, FS, 0.0, Float64Array.from([freq - h, freq + h])))
    let step = above - below
    // the pair straddles a wrap at most once, and never at these spacings
    // unless the filter has a large delay in it
    if (step > 180.0) step -= 360.0
    else if (step < -180.0) step += 360.0
    return (-step / (2.0 * h) / 360.0) * 1000.0
  }

  const cases: [string, Filter][] = [
    ["Butterworth lowpass", filter("BiquadCombo", { type: "ButterworthLowpass", order: 6, freq: 800.0 })],
    ["peaking", filter("Biquad", { type: "Peaking", freq: 1000.0, q: 4.0, gain: 8.0 })],
    ["low shelf", filter("Biquad", { type: "Lowshelf", freq: 300.0, q: 0.7, gain: -6.0 })],
    ["allpass", filter("Biquad", { type: "Allpass", freq: 2000.0, q: 1.5 })],
    ["subsample delay", filter("Delay", { delay: 3.7, delay_unit: "samples", subsample: true })],
    ["DiffEq", filter("DiffEq", { a: [1.0, -0.4, 0.2], b: [0.5, 0.3, -0.1] })],
    ["Tilt", filter("BiquadCombo", { type: "Tilt", gain: 6.0 })],
  ]

  it.each(cases)("%s", (_name, f) => {
    const freqs = [50.0, 200.0, 700.0, 1000.0, 3000.0, 9000.0]
    const exact = groupDelay(f, freqs)
    freqs.forEach((freq, n) => expect(exact[n]).toBeCloseTo(slopeOfPhase(f, freq), 6))
  })

  it("walks up to a notch without the singularity spreading", () => {
    // The zero sits on the unit circle: the magnitude is a true null and the
    // phase turns through 180 degrees across it. The delay either side does not
    // turn with it, because a Notch's numerator is symmetric and contributes
    // exactly its centre tap, one sample, however deep the null. Only the point
    // that lands on the zero itself is lost, and it is lost to floating point
    // rather than to the mathematics: 0/0 is a gap, not a spike.
    const freq = 1000.0
    const notch = filter("Biquad", { type: "Notch", freq, q: 2.0 })
    expect(Number.isFinite(groupDelay(notch, [freq])[0])).toBe(false)
    // a Hz either side it is the slope of the phase, as everywhere else
    const outside = [freq - 1.0, freq + 1.0]
    groupDelay(notch, outside).forEach((delay, n) => expect(delay).toBeCloseTo(slopeOfPhase(notch, outside[n]), 6))
    // and it is continuous across the zero itself: a thousandth of a Hz either
    // side of it, with the 180 degree jump in between, the two agree to what
    // the curve genuinely changes by over that distance
    const [justBelow, justAbove] = groupDelay(notch, [freq - 0.001, freq + 0.001])
    expect(justBelow).toBeCloseTo(justAbove, 4)
  })

  it("adds up along a cascade", () => {
    // Filters multiply and delays add, which is what lets a whole pipeline step
    // be summed rather than differentiated back out of the product's phase.
    const freqs = [100.0, 1000.0, 5000.0]
    const one = filter("Biquad", { type: "Peaking", freq: 1000.0, q: 2.0, gain: 6.0 })
    const two = filter("Delay", { delay: 2.0, delay_unit: "ms" })
    const both = filter("DiffEq", { a: [1.0], b: [0.0, 0.0, 1.0] })
    const sum = groupDelay(one, freqs).map((d, n) => d + groupDelay(two, freqs)[n] + groupDelay(both, freqs)[n])
    const product = complexGain(one, FS, 0.0, Float64Array.from(freqs))
    multiplyInto(product, complexGain(two, FS, 0.0, Float64Array.from(freqs)))
    multiplyInto(product, complexGain(both, FS, 0.0, Float64Array.from(freqs)))
    // the sum is the delay of the product, checked against the product's own phase
    freqs.forEach((freq, n) => {
      const h = 0.05
      const pair = [freq - h, freq + h]
      const curves = [one, two, both].map((f) => complexGain(f, FS, 0.0, Float64Array.from(pair)))
      const total = curves.reduce((acc, curve) => {
        multiplyInto(acc, curve)
        return acc
      })
      const [pbelow, pabove] = phaseDegrees(total)
      let step = pabove - pbelow
      while (step > 180.0) step -= 360.0
      while (step < -180.0) step += 360.0
      expect(sum[n]).toBeCloseTo((-step / (2.0 * h) / 360.0) * 1000.0, 6)
    })
  })
})

describe("Conv", () => {
  // The only closed form checks the convolution path has: the FFT, the peak
  // search, the delay removal and the interpolation onto the log grid are
  // otherwise covered by nothing.
  //
  // Evaluated on the grid the plots actually use, because the phase of a
  // delayed impulse advances quickly and the unwrap needs the slope to build
  // up gradually, which is what a log grid starting at 10 Hz gives it.
  const FREQS = Array.from(logspace(10.0, (0.95 * FS) / 2, 1000))

  /** The group delay in ms of an impulse response, as a whole step plots it. */
  function convDelayMs(impulse: number[], removeDelay = false): number[] {
    return delayInMs(convGroupDelay(impulse, FS, FREQS, removeDelay), FS)
  }

  function impulseAt(index: number, amplitude = 1.0): number[] {
    const impulse = new Array<number>(index + 1).fill(0.0)
    impulse[index] = amplitude
    return impulse
  }

  it("passes everything at unity when it is a single unit impulse", () => {
    magnitudeDb(convComplexGain(impulseAt(0), FS, FREQS)).forEach((gain) => expect(gain).toBeCloseTo(0.0, 9))
  })

  it("is flat at the gain of a scaled impulse", () => {
    for (const amplitude of [0.25, 2.0]) {
      const gains = magnitudeDb(convComplexGain(impulseAt(0, amplitude), FS, FREQS))
      gains.forEach((gain) => expect(gain).toBeCloseTo(20 * Math.log10(amplitude), 9))
    }
  })

  it("delays by N samples when its impulse sits at sample N", () => {
    // Flat magnitude and exactly N/fs of group delay, which is what makes this
    // a pure delay rather than merely something that looks like one. Exactly,
    // because the phase of a delay is linear and interpolating a straight line
    // is lossless: this is the assertion that caught the index mapping in
    // `interpolate` reading a fifth of a percent off in frequency.
    //
    // The long ones matter as much as the short: 20000 samples is 417 ms, whose
    // phase turns through nearly a hundred whole circles between two points at
    // the top of the plot grid.
    for (const n of [1, 37, 200, 1000, 20000]) {
      const impulse = impulseAt(n)
      magnitudeDb(convComplexGain(impulse, FS, FREQS)).forEach((gain) => expect(gain).toBeCloseTo(0.0, 6))
      convDelayMs(impulse).forEach((delay) => expect(delay).toBeCloseTo((n / FS) * 1000.0, 9))
    }
  })

  it("takes that delay back out when asked to remove it", () => {
    // The single filter plot rotates the bulk delay out, by the position of
    // the peak, so the same impulse comes back with no delay at all. The
    // rotation happens on the FFT's own grid, where it cancels exactly.
    for (const n of [1, 37, 200, 500, 20000]) {
      convDelayMs(impulseAt(n), true).forEach((delay) => expect(delay).toBeCloseTo(0.0, 9))
    }
  })

  it("has the constant group delay of its centre tap when it is symmetric", () => {
    // A symmetric FIR is linear phase by construction, so its group delay is
    // half its length whatever its magnitude response does.
    //
    // At every frequency, stopband nulls included, which is the property that
    // reading the delay off the phase could not deliver: `Re(G/H)` works out to
    // the centre tap plus a term that is purely imaginary, so the singularity
    // at a null lands entirely in the part this throws away.
    const taps = 257
    const centre = (taps - 1) / 2
    const cutoff = 0.15
    const impulse = Array.from({ length: taps }, (_, n) => {
      const k = n - centre
      const sinc = k === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * k) / (Math.PI * k)
      return sinc * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1)))
    })
    const expected = (centre / FS) * 1000.0
    const passband = FREQS.filter((f) => f < 0.5 * cutoff * FS).length
    const delays = convDelayMs(impulse)
    delays.slice(0, passband).forEach((delay) => expect(delay).toBeCloseTo(expected, 9))
    // Across the nulls as well, where the ratio is a small number over a small
    // number and the cancellation costs a few digits. A nanosecond of them, not
    // the whole turns of the grid that reading it off the phase was worth.
    delays.forEach((delay) => expect(Math.abs(delay - expected)).toBeLessThan(1e-6))
    // and the peak search finds that centre tap, so removing the delay flattens it
    convDelayMs(impulse, true).forEach((delay) => expect(Math.abs(delay)).toBeLessThan(1e-6))
  })

  it("matches the definition of the transform, wherever the impulse sits", () => {
    // The transfer function of an FIR filter is the sum of h[n] exp(-j w n), so
    // that sum is the answer, with no FFT, no interpolation and no unwrapping
    // anywhere near it. An impulse late in a long response is the case that
    // fails if the bulk delay is not taken out before the phase is unwrapped
    // on the FFT grid, since the phase then turns by most of a circle from one
    // bin to the next.
    for (const peak of [3, 400, 700, 900]) {
      const h = new Array<number>(1000).fill(0.0)
      h[peak] = 1.0
      h[peak + 1] = 0.5
      h[peak + 2] = -0.25
      const curve = convComplexGain(h, FS, FREQS)
      const magnitude = magnitudeDb(curve)
      const phase = phaseDegrees(curve)
      FREQS.forEach((f, i) => {
        let re = 0.0
        let im = 0.0
        for (let n = 0; n < h.length; n++) {
          const w = (-2.0 * Math.PI * f * n) / FS
          re += h[n] * Math.cos(w)
          im += h[n] * Math.sin(w)
        }
        expect(magnitude[i]).toBeCloseTo(20 * Math.log10(Math.hypot(re, im)), 6)
        const exact = Math.atan2(im, re) * (180.0 / Math.PI)
        const off = Math.abs(phase[i] - exact) % 360.0
        expect(Math.min(off, 360.0 - off)).toBeLessThan(1e-6)
      })
    }
  })

  it("draws the knee of a highpass where it really is", () => {
    // The case the plot grid is hardest on: a log axis puts hundreds of points
    // below 100 Hz, so the FFT has to resolve that region rather than have it
    // interpolated across. Compared against the exact transform, and only
    // where the response means something: a highpass stopband is full of nulls
    // that fall between any two bins, and no sampled representation has them.
    const taps = 2001
    const centre = (taps - 1) / 2
    const fc = 80.0 / FS
    const h = Array.from({ length: taps }, (_, n) => {
      const k = n - centre
      const lowpass = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k)
      const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (taps - 1))
      return ((k === 0 ? 1 : 0) - lowpass) * window
    })
    const magnitude = magnitudeDb(convComplexGain(h, FS, FREQS))
    let compared = 0
    FREQS.forEach((f, i) => {
      let re = 0.0
      let im = 0.0
      for (let n = 0; n < taps; n++) {
        const w = (-2.0 * Math.PI * f * n) / FS
        re += h[n] * Math.cos(w)
        im += h[n] * Math.sin(w)
      }
      const exact = 20 * Math.log10(Math.hypot(re, im))
      if (exact < -40) return
      compared++
      expect(magnitude[i]).toBeCloseTo(exact, 1)
    })
    // the knee is in there, not just the flat top
    expect(FREQS.filter((f, i) => f < 200 && magnitude[i] > -40).length).toBeGreaterThan(20)
    expect(compared).toBeGreaterThan(500)
  })

  it("has the sum of its coefficients as its gain at low frequency", () => {
    // At DC the transfer function is just the sum, and the first plotted point
    // sits close enough to DC for the interpolation to show it.
    const impulse = [0.5, 0.25, 0.125, 0.0625]
    const sum = impulse.reduce((total, value) => total + value, 0.0)
    expect(magnitudeDb(convComplexGain(impulse, FS, [1.0]))[0]).toBeCloseTo(20 * Math.log10(sum), 3)
  })
})
