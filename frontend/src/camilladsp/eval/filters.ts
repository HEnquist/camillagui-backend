/**
 * Transfer functions for every filter type, ported from the GUI backend's
 * former `backend/dsp/filters.py`.
 *
 * Conv is the one type that is not here: it needs coefficients, which come
 * either from the config or from the backend, so it lives in `conv.ts` and is
 * driven from `index.ts`.
 */
import { Filter } from "../config"
import { evalBiquad } from "./biquad"
import { ComplexCurve, constantCurve, multiplyInto, unitCurve, zeroCurve } from "./complex"
import {
  GAIN_SCALE,
  GRAPHIC_EQ_FREQ_MAX,
  GRAPHIC_EQ_FREQ_MIN,
  LOUDNESS_HIGH_BOOST,
  LOUDNESS_HIGH_FREQ,
  LOUDNESS_HIGH_Q,
  LOUDNESS_LOW_BOOST,
  LOUDNESS_LOW_FREQ,
  LOUDNESS_LOW_Q,
  NPOINT_PEQ_MIN_GAIN,
} from "./defaults"
import { FilterEvalError, flag, num, numListOr, numOr, optStr, Params, peqBands, positiveNumOr } from "./params"

/**
 * Filter types that pass audio through unchanged as far as a frequency
 * response plot is concerned. They still have to be handled, so that a step
 * containing one plots the rest of the step instead of failing.
 */
export const FLAT_FILTER_TYPES = ["Volume", "Dither", "Clipper", "LookaheadLimiter"]

/** The Q values of the second order sections of a Butterworth filter. */
function butterworthQ(order: number): number[] {
  const odd = order % 2 > 0
  const nSecondOrder = Math.floor(order / 2.0)
  const qvalues: number[] = []
  for (let n = 0; n < nSecondOrder; n++) {
    qvalues.push(1 / (2.0 * Math.sin((Math.PI / order) * (n + 1 / 2))))
  }
  // a negative Q is the sentinel for the leftover first order section of an
  // odd order filter, which has no Q of its own
  if (odd) qvalues.push(-1.0)
  return qvalues
}

/** The biquads a BiquadCombo expands into. */
function biquadComboSections(params: Params): Params[] {
  const ftype = params.type
  switch (ftype) {
    case "LinkwitzRileyHighpass":
    case "LinkwitzRileyLowpass":
    case "ButterworthHighpass":
    case "ButterworthLowpass": {
      const order = num(params, "order")
      const freq = num(params, "freq")
      const lowpass = ftype === "LinkwitzRileyLowpass" || ftype === "ButterworthLowpass"
      const typeSecondOrder = lowpass ? "Lowpass" : "Highpass"
      const typeFirstOrder = lowpass ? "LowpassFO" : "HighpassFO"
      let qvalues: number[]
      if (ftype === "LinkwitzRileyHighpass" || ftype === "LinkwitzRileyLowpass") {
        // A Linkwitz-Riley filter is two cascaded Butterworths of half the
        // order. When that half order is itself odd, its two first order
        // sections combine into a single second order section with Q = 0.5.
        let half = butterworthQ(order / 2)
        if ((order / 2) % 2 > 0) {
          half = half.slice(0, -1)
          qvalues = half.concat(half, [0.5])
        } else {
          qvalues = half.concat(half)
        }
      } else {
        qvalues = butterworthQ(order)
      }
      const sections: Params[] = []
      for (const q of qvalues) {
        // a first order section has no Q of its own
        if (q < 0) sections.push({ freq, type: typeFirstOrder })
        else sections.push({ freq, q, type: typeSecondOrder })
      }
      return sections
    }
    case "NPointPeq": {
      // The role of a band follows its position: the first is a low shelf, the
      // last a high shelf, and the ones between are peaking filters. A band
      // with no significant gain does nothing, so the DSP leaves it out; skip
      // it here too so the plot matches.
      const bands = peqBands(params, "bands")
      const last = bands.length - 1
      const sections: Params[] = []
      bands.forEach((band, n) => {
        if (Math.abs(band.gain) <= NPOINT_PEQ_MIN_GAIN) return
        const type = n === 0 ? "Lowshelf" : n === last ? "Highshelf" : "Peaking"
        sections.push({ freq: band.freq, q: band.q, gain: band.gain, type })
      })
      return sections
    }
    case "GraphicEqualizer": {
      const gains = numListOr(params, "gains", [])
      const bands = gains.length
      // zero is invalid here, the DSP rejects it, and must fall back to the
      // default rather than reach log2
      const fMinLog = Math.log2(positiveNumOr(params, "freq_min", GRAPHIC_EQ_FREQ_MIN))
      const fMaxLog = Math.log2(positiveNumOr(params, "freq_max", GRAPHIC_EQ_FREQ_MAX))
      const bandwidth = (fMaxLog - fMinLog) / bands
      const sections: Params[] = []
      gains.forEach((gain, band) => {
        if (Math.abs(gain) > 0.01) {
          const freqLog = fMinLog + (band + 0.5) * bandwidth
          sections.push({ freq: Math.pow(2.0, freqLog), bandwidth, gain, type: "Peaking" })
        }
      })
      return sections
    }
    case "Tilt": {
      const gain = num(params, "gain")
      return [
        { freq: 110.0, q: 0.35, gain: -gain / 2.0, type: "Lowshelf" },
        { freq: 3500.0, q: 0.35, gain: gain / 2.0, type: "Highshelf" },
      ]
    }
    default:
      throw new FilterEvalError(`Unknown BiquadCombo subtype ${String(ftype)}`)
  }
}

function biquadComboComplexGain(params: Params, fs: number, freq: ArrayLike<number>): ComplexCurve {
  const curve = unitCurve(freq.length)
  for (const section of biquadComboSections(params)) {
    multiplyInto(curve, evalBiquad(section, fs, freq))
  }
  return curve
}

function loudnessComplexGain(params: Params, fs: number, volume: number, freq: ArrayLike<number>): ComplexCurve {
  const relativeVolume = volume - num(params, "reference_level")
  let relativeBoost = -relativeVolume / 20.0
  if (relativeBoost > 1.0) relativeBoost = 1.0
  else if (relativeBoost < 0.0) relativeBoost = 0.0
  const highBoost = relativeBoost * numOr(params, "high_boost", LOUDNESS_HIGH_BOOST)
  const lowBoost = relativeBoost * numOr(params, "low_boost", LOUDNESS_LOW_BOOST)
  const midGain = flag(params, "attenuate_mid") ? Math.pow(10.0, -Math.max(highBoost, lowBoost) / 20.0) : 1.0

  // The shelves take a Q, as in the DSP. The default Q is equivalent to the
  // fixed 12 dB/octave slope used before these parameters existed.
  const sections: Params[] = [
    {
      freq: numOr(params, "low_freq", LOUDNESS_LOW_FREQ),
      q: numOr(params, "low_q", LOUDNESS_LOW_Q),
      gain: lowBoost,
      type: "Lowshelf",
    },
    {
      freq: numOr(params, "high_freq", LOUDNESS_HIGH_FREQ),
      q: numOr(params, "high_q", LOUDNESS_HIGH_Q),
      gain: highBoost,
      type: "Highshelf",
    },
  ]
  const curve = constantCurve(freq.length, midGain)
  for (const section of sections) multiplyInto(curve, evalBiquad(section, fs, freq))
  return curve
}

function gainComplexGain(params: Params, freq: ArrayLike<number>): ComplexCurve {
  const sign = flag(params, "inverted") ? -1.0 : 1.0
  const gain = num(params, "gain")
  const scale = optStr(params, "scale") ?? GAIN_SCALE
  const value = scale === "dB" ? Math.pow(10.0, gain / 20.0) * sign : gain * sign
  return constantCurve(freq.length, value)
}

/** The delay in samples, in whichever unit the config gives it. */
function delayInSamples(params: Params, fs: number): number {
  const delay = num(params, "delay")
  const unit = optStr(params, "delay_unit") ?? "ms"
  switch (unit) {
    case "ms":
      return (delay / 1000.0) * fs
    case "us":
      return (delay / 1000000.0) * fs
    case "s":
      return delay * fs
    case "mm":
      return ((delay / 1000.0) * fs) / 343.0
    case "samples":
      return delay
    default:
      throw new FilterEvalError(`Unknown delay unit ${unit}`)
  }
}

function delayComplexGain(params: Params, fs: number, freq: ArrayLike<number>): ComplexCurve {
  const delaySamples = delayInSamples(params, fs)
  // a delay this short cannot be resolved by the allpass, and the DSP falls
  // back to a whole number of samples
  const subsample = flag(params, "subsample") && delaySamples >= 0.1

  let curve: ComplexCurve
  let fullSamples: number
  if (subsample) {
    let full = Math.floor(delaySamples)
    let fraction = delaySamples - full
    let a1: number
    let a2: number
    let b0: number
    let b1: number
    let b2: number
    if (delaySamples < 1.1) {
      full = 0
      fraction = delaySamples
      a1 = (1.0 - fraction) / (1.0 + fraction)
      a2 = 0.0
      b0 = (1.0 - fraction) / (1.0 + fraction)
      b1 = 1.0
      b2 = 0.0
    } else {
      // the second order allpass needs a fraction of at least about one
      // sample, so borrow whole samples from the integer part until it does
      full -= 1.0
      fraction += 1.0
      if (fraction < 1.1) {
        full -= 1.0
        fraction += 1.0
      }
      const coeff1 = (2.0 * (2.0 - fraction)) / (1.0 + fraction)
      const coeff2 = (((2.0 - fraction) / (2.0 + fraction)) * (1.0 - fraction)) / (1.0 + fraction)
      a1 = coeff1
      a2 = coeff2
      b0 = coeff2
      b1 = coeff1
      b2 = 1.0
    }
    fullSamples = full
    curve = zeroCurve(freq.length)
    for (let n = 0; n < freq.length; n++) {
      const w = (2 * Math.PI * freq[n]) / fs
      const c1 = Math.cos(w)
      const s1 = -Math.sin(w)
      const c2 = Math.cos(2 * w)
      const s2 = -Math.sin(2 * w)
      const nre = b0 + b1 * c1 + b2 * c2
      const nim = b1 * s1 + b2 * s2
      const dre = 1.0 + a1 * c1 + a2 * c2
      const dim = a1 * s1 + a2 * s2
      const denom = dre * dre + dim * dim
      curve.re[n] = (nre * dre + nim * dim) / denom
      curve.im[n] = (nim * dre - nre * dim) / denom
    }
  } else {
    fullSamples = Math.round(delaySamples)
    curve = unitCurve(freq.length)
  }

  const delaySeconds = fullSamples / fs
  for (let n = 0; n < freq.length; n++) {
    const angle = -2.0 * Math.PI * freq[n] * delaySeconds
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    const re = curve.re[n] * wr - curve.im[n] * wi
    const im = curve.re[n] * wi + curve.im[n] * wr
    curve.re[n] = re
    curve.im[n] = im
  }
  return curve
}

function diffEqComplexGain(params: Params, fs: number, freq: ArrayLike<number>): ComplexCurve {
  const a = numListOr(params, "a", [1.0])
  const b = numListOr(params, "b", [1.0])
  const curve = zeroCurve(freq.length)
  for (let n = 0; n < freq.length; n++) {
    const w = (2 * Math.PI * freq[n]) / fs
    let nre = 0.0
    let nim = 0.0
    for (let k = 0; k < b.length; k++) {
      nre += b[k] * Math.cos(k * w)
      nim -= b[k] * Math.sin(k * w)
    }
    let dre = 0.0
    let dim = 0.0
    for (let k = 0; k < a.length; k++) {
      dre += a[k] * Math.cos(k * w)
      dim -= a[k] * Math.sin(k * w)
    }
    const denom = dre * dre + dim * dim
    curve.re[n] = (nre * dre + nim * dim) / denom
    curve.im[n] = (nim * dre - nre * dim) / denom
  }
  return curve
}

/**
 * The transfer function of any filter except Conv, which needs coefficients
 * and is evaluated from `index.ts` instead.
 */
export function complexGain(filterconf: Filter, fs: number, volume: number, freq: ArrayLike<number>): ComplexCurve {
  const params = (filterconf.parameters ?? {}) as Params
  switch (filterconf.type) {
    case "Biquad":
      return evalBiquad(params, fs, freq)
    case "BiquadCombo":
      return biquadComboComplexGain(params, fs, freq)
    case "DiffEq":
      return diffEqComplexGain(params, fs, freq)
    case "Delay":
      return delayComplexGain(params, fs, freq)
    case "Gain":
      return gainComplexGain(params, freq)
    case "Loudness":
      return loudnessComplexGain(params, fs, volume, freq)
    default:
      if (FLAT_FILTER_TYPES.includes(filterconf.type)) return unitCurve(freq.length)
      throw new FilterEvalError(`Unknown filter type ${filterconf.type}`)
  }
}
