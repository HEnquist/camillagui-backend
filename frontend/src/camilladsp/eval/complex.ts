/**
 * Just enough complex arithmetic for filter evaluation.
 *
 * Evaluation is elementwise over a frequency vector, so a curve is a pair of
 * Float64Arrays rather than an array of complex objects. That keeps the whole
 * thing allocation free in the inner loops and avoids pulling in a complex
 * number library for the handful of operations used here.
 */

export interface ComplexCurve {
  re: Float64Array
  im: Float64Array
}

export function zeroCurve(npoints: number): ComplexCurve {
  return { re: new Float64Array(npoints), im: new Float64Array(npoints) }
}

/** A curve that is `value` at every point, with no imaginary part. */
export function constantCurve(npoints: number, value: number): ComplexCurve {
  const curve = zeroCurve(npoints)
  curve.re.fill(value)
  return curve
}

export function unitCurve(npoints: number): ComplexCurve {
  return constantCurve(npoints, 1.0)
}

/** Multiply `target` by `factor` in place, elementwise. */
export function multiplyInto(target: ComplexCurve, factor: ComplexCurve): void {
  const { re, im } = target
  for (let n = 0; n < re.length; n++) {
    const r = re[n] * factor.re[n] - im[n] * factor.im[n]
    const i = re[n] * factor.im[n] + im[n] * factor.re[n]
    re[n] = r
    im[n] = i
  }
}

/**
 * Multiply `target` in place by the response of a pure delay, `exp(-j*2*pi*f*t)`.
 *
 * Closed form at every frequency, so unlike a delay carried in a sampled phase
 * curve there is nothing here to unwrap and no grid to be too coarse.
 */
export function applyDelayInto(target: ComplexCurve, delaySeconds: number, freq: ArrayLike<number>): void {
  const { re, im } = target
  for (let n = 0; n < re.length; n++) {
    const angle = -2.0 * Math.PI * freq[n] * delaySeconds
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    const r = re[n] * wr - im[n] * wi
    im[n] = re[n] * wi + im[n] * wr
    re[n] = r
  }
}

/** Magnitude in dB, with the same small offset the DSP plots use to keep log10 finite. */
export function magnitudeDb(curve: ComplexCurve): number[] {
  const out = new Array<number>(curve.re.length)
  for (let n = 0; n < out.length; n++) {
    out[n] = 20.0 * Math.log10(Math.hypot(curve.re[n], curve.im[n]) + 1.0e-15)
  }
  return out
}

/** Phase in degrees, wrapped to (-180, 180]. */
export function phaseDegrees(curve: ComplexCurve): number[] {
  const out = new Array<number>(curve.re.length)
  for (let n = 0; n < out.length; n++) {
    out[n] = Math.atan2(curve.im[n], curve.re[n]) * (180.0 / Math.PI)
  }
  return out
}

/**
 * How far below a curve's own peak the phase stops being worth drawing.
 *
 * This is a legibility threshold, not an accuracy one. The numbers down there
 * are right: a 1001 tap windowed sinc lowpass reaches -201 dB at 22 kHz, and
 * the plot agrees with 80 digit arithmetic to 0.002 dB, because a float64 FFT
 * of that filter does not reach its own noise floor until about -272 dB.
 *
 * 150 dB was picked by trying it on real filters. It took the hash out of the
 * plots and hid nothing anyone wanted to see.
 */
export const PHASE_NOISE_FLOOR_DB = 150.0

/**
 * The level below which a convolution filter's phase is not worth drawing.
 *
 * The phase there is correct and unreadable. An FIR's stopband is a run of
 * nulls spaced fs/taps apart, 48 Hz for a 1001 tap filter, and the phase turns
 * through a full circle at each one. The plot's log grid is 155 Hz per point at
 * 20 kHz, so three of those nulls fall between neighbouring points and the
 * phase is sampled far too sparsely to show what it does. What gets drawn is
 * the aliasing, a hash of values between -180 and 180. The magnitude is smooth
 * at the same frequencies and is left alone.
 *
 * Only for a convolution filter. A 4th order Butterworth highpass at 1000 Hz is
 * 240 dB down at 1 Hz, deeper than anything here, and its phase is smooth,
 * slowly varying and perfectly readable: it has no nulls to rotate through.
 * Depth alone is not the problem, density of nulls is, and only an FIR has them.
 *
 * The group delay is hidden here too, so that the two curves agree about where
 * the filter stops being readable. That is now only a display choice: the delay
 * is computed from the coefficients rather than read off the phase, see
 * `groupdelay.ts`, so a value in this region is wrong about itself and about
 * nothing else. It used to be load bearing, and an unblanked phase moved the
 * readable group delay of a highpass by as much as 608 ms.
 *
 * Blanked points are NaN, which the plot draws as a gap in the line rather
 * than as a value.
 */
export function phaseNoiseFloor(magnitude: ArrayLike<number>): number {
  let peak = -Infinity
  for (let n = 0; n < magnitude.length; n++) if (magnitude[n] > peak) peak = magnitude[n]
  return peak - PHASE_NOISE_FLOOR_DB
}

/** Blank a curve, in place, wherever the magnitude falls below `floor`. */
export function blankPhaseBelow(floor: number, magnitude: ArrayLike<number>, phase: number[]): void {
  for (let n = 0; n < phase.length; n++) if (magnitude[n] < floor) phase[n] = NaN
}
