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
