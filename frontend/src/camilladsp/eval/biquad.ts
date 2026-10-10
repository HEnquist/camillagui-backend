/**
 * Biquad coefficients, ported from CamillaDSP's `src/filters/biquad.rs` by way
 * of the GUI backend's former `backend/dsp/filters.py`.
 */
import { ComplexCurve, zeroCurve } from "./complex"
import { rationalGroupDelay } from "./groupdelay"
import { FilterEvalError, flag, num, optNum, Params } from "./params"

/** Normalized biquad coefficients, with a0 divided out. */
export interface BiquadCoefficients {
  a1: number
  a2: number
  b0: number
  b1: number
  b2: number
}

/**
 * Q or bandwidth, whichever the config supplies. Peaking, Notch, Bandpass and
 * Allpass all accept either, and the validator rejects a config that gives
 * both or neither.
 */
function alphaFromQOrBandwidth(params: Params, omega: number, sn: number): number {
  const q = optNum(params, "q")
  if (q !== undefined) return sn / (2.0 * q)
  const bandwidth = optNum(params, "bandwidth")
  if (bandwidth !== undefined) return sn * Math.sinh(((Math.log(2.0) / 2.0) * bandwidth * omega) / sn)
  throw new FilterEvalError("Missing 'q' or 'bandwidth'")
}

/**
 * The shelf steepness, as either a slope in dB/octave or a Q. Returns the
 * `beta` term the shelf coefficients are built from.
 */
function shelfBeta(params: Params, ampl: number, sn: number): number {
  const slope = optNum(params, "slope")
  if (slope !== undefined) {
    const alpha = (sn / 2.0) * Math.sqrt((ampl + 1.0 / ampl) * (1.0 / (slope / 12.0) - 1.0) + 2.0)
    return 2.0 * Math.sqrt(ampl) * alpha
  }
  const q = optNum(params, "q")
  if (q !== undefined) return (sn * Math.sqrt(ampl)) / q
  throw new FilterEvalError("Missing 'q' or 'slope'")
}

/**
 * Coefficients for one biquad subtype.
 *
 * Unknown subtypes throw rather than falling through. The Python this was
 * ported from used a chain that started with a stray `if` instead of `elif`,
 * so an unrecognised subtype died with an UnboundLocalError instead.
 */
export function biquadCoefficients(params: Params, fs: number): BiquadCoefficients {
  const ftype = params.type
  let a0: number
  let a1: number
  let a2: number
  let b0: number
  let b1: number
  let b2: number

  switch (ftype) {
    case "Free": {
      a0 = 1.0
      a1 = num(params, "a1")
      a2 = num(params, "a2")
      b0 = num(params, "b0")
      b1 = num(params, "b1")
      b2 = num(params, "b2")
      break
    }
    case "Highpass": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const sn = Math.sin(omega)
      const cs = Math.cos(omega)
      const alpha = sn / (2.0 * num(params, "q"))
      b0 = (1.0 + cs) / 2.0
      b1 = -(1.0 + cs)
      b2 = (1.0 + cs) / 2.0
      a0 = 1.0 + alpha
      a1 = -2.0 * cs
      a2 = 1.0 - alpha
      break
    }
    case "Lowpass": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const sn = Math.sin(omega)
      const cs = Math.cos(omega)
      const alpha = sn / (2.0 * num(params, "q"))
      b0 = (1.0 - cs) / 2.0
      b1 = 1.0 - cs
      b2 = (1.0 - cs) / 2.0
      a0 = 1.0 + alpha
      a1 = -2.0 * cs
      a2 = 1.0 - alpha
      break
    }
    case "Peaking": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const sn = Math.sin(omega)
      const cs = Math.cos(omega)
      const ampl = Math.pow(10.0, num(params, "gain") / 40.0)
      const alpha = alphaFromQOrBandwidth(params, omega, sn)
      b0 = 1.0 + alpha * ampl
      b1 = -2.0 * cs
      b2 = 1.0 - alpha * ampl
      a0 = 1.0 + alpha / ampl
      a1 = -2.0 * cs
      a2 = 1.0 - alpha / ampl
      break
    }
    case "HighshelfFO": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const ampl = Math.pow(10.0, num(params, "gain") / 40.0)
      const tn = Math.tan(omega / 2)
      b0 = ampl * tn + ampl ** 2
      b1 = ampl * tn - ampl ** 2
      b2 = 0.0
      a0 = ampl * tn + 1
      a1 = ampl * tn - 1
      a2 = 0.0
      break
    }
    case "Highshelf": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const ampl = Math.pow(10.0, num(params, "gain") / 40.0)
      const sn = Math.sin(omega)
      const cs = Math.cos(omega)
      const beta = shelfBeta(params, ampl, sn)
      b0 = ampl * (ampl + 1.0 + (ampl - 1.0) * cs + beta)
      b1 = -2.0 * ampl * (ampl - 1.0 + (ampl + 1.0) * cs)
      b2 = ampl * (ampl + 1.0 + (ampl - 1.0) * cs - beta)
      a0 = ampl + 1.0 - (ampl - 1.0) * cs + beta
      a1 = 2.0 * (ampl - 1.0 - (ampl + 1.0) * cs)
      a2 = ampl + 1.0 - (ampl - 1.0) * cs - beta
      break
    }
    case "LowshelfFO": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const ampl = Math.pow(10.0, num(params, "gain") / 40.0)
      const tn = Math.tan(omega / 2)
      b0 = ampl ** 2 * tn + ampl
      b1 = ampl ** 2 * tn - ampl
      b2 = 0.0
      a0 = tn + ampl
      a1 = tn - ampl
      a2 = 0.0
      break
    }
    case "Lowshelf": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const ampl = Math.pow(10.0, num(params, "gain") / 40.0)
      const sn = Math.sin(omega)
      const cs = Math.cos(omega)
      const beta = shelfBeta(params, ampl, sn)
      b0 = ampl * (ampl + 1.0 - (ampl - 1.0) * cs + beta)
      b1 = 2.0 * ampl * (ampl - 1.0 - (ampl + 1.0) * cs)
      b2 = ampl * (ampl + 1.0 - (ampl - 1.0) * cs - beta)
      a0 = ampl + 1.0 + (ampl - 1.0) * cs + beta
      a1 = -2.0 * (ampl - 1.0 + (ampl + 1.0) * cs)
      a2 = ampl + 1.0 + (ampl - 1.0) * cs - beta
      break
    }
    case "LowpassFO": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const k = Math.tan(omega / 2.0)
      const alpha = 1 + k
      a0 = 1.0
      a1 = -((1 - k) / alpha)
      a2 = 0.0
      b0 = k / alpha
      b1 = k / alpha
      b2 = 0
      break
    }
    case "HighpassFO": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const k = Math.tan(omega / 2.0)
      const alpha = 1 + k
      a0 = 1.0
      a1 = -((1 - k) / alpha)
      a2 = 0.0
      b0 = 1.0 / alpha
      b1 = -1.0 / alpha
      b2 = 0
      break
    }
    case "Notch": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const sn = Math.sin(omega)
      const cs = Math.cos(omega)
      const alpha = alphaFromQOrBandwidth(params, omega, sn)
      b0 = 1.0
      b1 = -2.0 * cs
      b2 = 1.0
      a0 = 1.0 + alpha
      a1 = -2.0 * cs
      a2 = 1.0 - alpha
      break
    }
    case "GeneralNotch": {
      const fP = num(params, "freq_p")
      const fZ = num(params, "freq_z")
      const qP = num(params, "q_p")
      const normalizeAtDc = flag(params, "normalize_at_dc")

      // apply pre-warping
      const tnZ = Math.tan((Math.PI * fZ) / fs)
      const tnP = Math.tan((Math.PI * fP) / fs)
      const alpha = tnP / qP
      const tn2P = tnP ** 2
      const tn2Z = tnZ ** 2

      const gain = normalizeAtDc ? tn2P / tn2Z : 1.0

      b0 = gain * (1.0 + tn2Z)
      b1 = -2.0 * gain * (1.0 - tn2Z)
      b2 = gain * (1.0 + tn2Z)
      a0 = 1.0 + alpha + tn2P
      a1 = -2.0 + 2.0 * tn2P
      a2 = 1.0 - alpha + tn2P
      break
    }
    case "Bandpass": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const sn = Math.sin(omega)
      const cs = Math.cos(omega)
      const alpha = alphaFromQOrBandwidth(params, omega, sn)
      b0 = alpha
      b1 = 0.0
      b2 = -alpha
      a0 = 1.0 + alpha
      a1 = -2.0 * cs
      a2 = 1.0 - alpha
      break
    }
    case "Allpass": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const sn = Math.sin(omega)
      const cs = Math.cos(omega)
      const alpha = alphaFromQOrBandwidth(params, omega, sn)
      b0 = 1.0 - alpha
      b1 = -2.0 * cs
      b2 = 1.0 + alpha
      a0 = 1.0 + alpha
      a1 = -2.0 * cs
      a2 = 1.0 - alpha
      break
    }
    case "AllpassFO": {
      const omega = (2.0 * Math.PI * num(params, "freq")) / fs
      const tn = Math.tan(omega / 2.0)
      const alpha = (tn + 1.0) / (tn - 1.0)
      b0 = 1.0
      b1 = alpha
      b2 = 0.0
      a0 = alpha
      a1 = 1.0
      a2 = 0.0
      break
    }
    case "LinkwitzTransform": {
      const f0 = num(params, "freq_act")
      const q0 = num(params, "q_act")
      const qt = num(params, "q_target")
      const ft = num(params, "freq_target")

      const d0i = (2.0 * Math.PI * f0) ** 2
      const d1i = (2.0 * Math.PI * f0) / q0
      const c0i = (2.0 * Math.PI * ft) ** 2
      const c1i = (2.0 * Math.PI * ft) / qt
      const fc = (ft + f0) / 2.0

      const gn = (2 * Math.PI * fc) / Math.tan((Math.PI * fc) / fs)
      const cci = c0i + gn * c1i + gn ** 2

      b0 = (d0i + gn * d1i + gn ** 2) / cci
      b1 = (2 * (d0i - gn ** 2)) / cci
      b2 = (d0i - gn * d1i + gn ** 2) / cci
      a0 = 1.0
      a1 = (2.0 * (c0i - gn ** 2)) / cci
      a2 = (c0i - gn * c1i + gn ** 2) / cci
      break
    }
    default:
      throw new FilterEvalError(`Unknown Biquad subtype ${String(ftype)}`)
  }

  return { a1: a1 / a0, a2: a2 / a0, b0: b0 / a0, b1: b1 / a0, b2: b2 / a0 }
}

/**
 * The transfer function of a biquad on a frequency vector, evaluated on the
 * unit circle at z = exp(j*2*pi*f/fs).
 */
export function biquadComplexGain(coeffs: BiquadCoefficients, fs: number, freq: ArrayLike<number>): ComplexCurve {
  const { a1, a2, b0, b1, b2 } = coeffs
  const curve = zeroCurve(freq.length)
  for (let n = 0; n < freq.length; n++) {
    // z^-1 and z^-2 on the unit circle
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
  return curve
}

/**
 * The group delay of a biquad in samples, from its coefficients.
 *
 * A biquad is a ratio of two three tap polynomials, so this is `rationalGroupDelay`
 * with nothing added. Exact at every frequency, including at a Notch's own
 * centre where the zero sits on the unit circle: that numerator is symmetric,
 * so its delay is exactly its centre tap, one sample, however deep the null.
 */
export function biquadGroupDelay(coeffs: BiquadCoefficients, fs: number, freq: ArrayLike<number>): Float64Array {
  const { a1, a2, b0, b1, b2 } = coeffs
  return rationalGroupDelay([b0, b1, b2], [1.0, a1, a2], fs, freq)
}

/** Build the biquad from a config and evaluate it in one step. */
export function evalBiquad(params: Params, fs: number, freq: ArrayLike<number>): ComplexCurve {
  return biquadComplexGain(biquadCoefficients(params, fs), fs, freq)
}

/** Build the biquad from a config and take its group delay in one step. */
export function evalBiquadGroupDelay(params: Params, fs: number, freq: ArrayLike<number>): Float64Array {
  return biquadGroupDelay(biquadCoefficients(params, fs), fs, freq)
}
