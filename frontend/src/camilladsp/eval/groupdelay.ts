/**
 * Group delay, computed from the coefficients rather than read off the phase.
 *
 * Differentiating `H(w) = sum h[k] exp(-jwk)` gives `dH/dw = -j*G(w)`, where
 * `G` is the transform of the same coefficients weighted by their own index,
 * `k*h[k]`. Since the group delay is `-d(arg H)/dw = -Im(H'/H)`, that is
 *
 *     tau(w) = Re( G(w) / H(w) )
 *
 * in samples. There is no phase in it. Every frequency stands alone, so unlike
 * a delay recovered by differentiating a sampled phase curve, nothing has to be
 * unwrapped, no whole turns have to be guessed at, and one bad point cannot
 * move its neighbours. It is also what `scipy.signal.group_delay` computes, so
 * the results are checkable point by point against SciPy.
 *
 * The formula is at its best exactly where reading the phase is at its worst.
 * Take a symmetric FIR, `H = exp(-jwM)*A(w)` with `A` real and `M` the centre
 * tap. Then `G/H` works out to `M + j*A'/A`: the singularity at a stopband null
 * is entirely in the imaginary part, and the real part is exactly `M` at every
 * frequency, nulls included. The old approach predicted each phase step from
 * the one below it, which meant walking the prediction through that same
 * stopband hash and carrying whole turn errors up into the passband.
 *
 * Nothing here knows about filter types. A biquad is a ratio of two three tap
 * polynomials, a DiffEq is a ratio of two longer ones, and a Conv is a single
 * long one, handled in `conv.ts` with the FFT it already computes.
 */

/**
 * The group delay of a polynomial in z^-1, in samples.
 *
 * `NaN` at a frequency where the polynomial has vanished into its own rounding
 * error, which happens only for a zero sitting on the unit circle, sampled
 * within a hair of dead centre: a Notch at 1000 Hz, evaluated at exactly
 * 1000 Hz. The answer there is `0/0`. In exact arithmetic it is a perfectly
 * ordinary number, since a symmetric numerator like that one contributes its
 * centre tap whatever its magnitude does, but in floating point both parts are
 * noise and the quotient is worth nothing, so it is a gap in the line rather
 * than a spike that takes the axis with it. One point either side of the zero
 * is unaffected: at the plot's own spacing the ratio is good to a part in 1e13.
 */
export function polynomialGroupDelay(coeffs: ArrayLike<number>, fs: number, freq: ArrayLike<number>): Float64Array {
  const out = new Float64Array(freq.length)
  // the largest the polynomial could be anywhere, so the smallest value that
  // can still be told apart from the error in adding the terms up
  let scale = 0.0
  for (let k = 0; k < coeffs.length; k++) scale += Math.abs(coeffs[k])
  const floor = scale * coeffs.length * Number.EPSILON
  for (let n = 0; n < freq.length; n++) {
    const w = (2.0 * Math.PI * freq[n]) / fs
    let pre = 0.0
    let pim = 0.0
    let gre = 0.0
    let gim = 0.0
    for (let k = 0; k < coeffs.length; k++) {
      const cos = Math.cos(k * w)
      const sin = Math.sin(k * w)
      pre += coeffs[k] * cos
      pim -= coeffs[k] * sin
      gre += k * coeffs[k] * cos
      gim -= k * coeffs[k] * sin
    }
    const denom = pre * pre + pim * pim
    out[n] = denom <= floor * floor ? NaN : (gre * pre + gim * pim) / denom
  }
  return out
}

/**
 * The group delay of `B(z)/A(z)` in samples, for any filter written as a ratio
 * of polynomials in z^-1.
 *
 * `arg H = arg B - arg A`, so the delays subtract.
 */
export function rationalGroupDelay(
  b: ArrayLike<number>,
  a: ArrayLike<number>,
  fs: number,
  freq: ArrayLike<number>,
): Float64Array {
  const numerator = polynomialGroupDelay(b, fs, freq)
  const denominator = polynomialGroupDelay(a, fs, freq)
  for (let n = 0; n < numerator.length; n++) numerator[n] -= denominator[n]
  return numerator
}

/** Add `delay` into `total`, elementwise. Group delay is additive along a cascade. */
export function addDelayInto(total: Float64Array, delay: ArrayLike<number>): void {
  for (let n = 0; n < total.length; n++) total[n] += delay[n]
}

/** Samples to milliseconds, the unit the plots draw. */
export function delayInMs(samples: ArrayLike<number>, fs: number): number[] {
  const out = new Array<number>(samples.length)
  for (let n = 0; n < out.length; n++) out[n] = (samples[n] / fs) * 1000.0
  return out
}
