/**
 * Convolution filters: the FFT of an impulse response, interpolated onto the
 * plot's log frequency grid.
 */
import { applyDelayInto, ComplexCurve, zeroCurve } from "./complex"
import { unwrapPhase } from "./unwrap"

/** The smallest power of two that is at least `n`. */
export function nextPow2(n: number): number {
  let points = 1
  while (points < n) points *= 2
  return points
}

/**
 * In place iterative radix-2 Cooley-Tukey FFT. `re` and `im` must have a
 * power of two length.
 *
 * Small enough to keep here rather than take a dependency for. A 262k point
 * transform runs in single digit milliseconds, which is well under the time
 * the round trip to the backend used to take, let alone the time the backend
 * spent re-reading the coefficient file and transforming it there.
 */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length
  // bit reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let tmp = re[i]
      re[i] = re[j]
      re[j] = tmp
      tmp = im[i]
      im[i] = im[j]
      im[j] = tmp
    }
  }
  // One twiddle table for the whole transform, each entry computed directly
  // rather than carried forward by a recurrence, which would accumulate error
  // across a stage. A 1M point transform would otherwise spend most of its
  // time in Math.cos and Math.sin.
  const half = n >> 1
  const twiddleRe = new Float64Array(half)
  const twiddleIm = new Float64Array(half)
  for (let k = 0; k < half; k++) {
    const angle = (-2 * Math.PI * k) / n
    twiddleRe[k] = Math.cos(angle)
    twiddleIm[k] = Math.sin(angle)
  }
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1
    const stride = n / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < halfLen; k++) {
        const wr = twiddleRe[k * stride]
        const wi = twiddleIm[k * stride]
        const a = i + k
        const b = a + halfLen
        const tr = re[b] * wr - im[b] * wi
        const ti = re[b] * wi + im[b] * wr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
}

/**
 * The index of the largest magnitude sample. Ties resolve to the last index,
 * matching the impulse peak search in the DSP.
 */
export function findPeak(impulse: ArrayLike<number>): number {
  let peak = -1
  let best = -1
  for (let n = 0; n < impulse.length; n++) {
    const magnitude = Math.abs(impulse[n])
    if (magnitude >= best) {
      best = magnitude
      peak = n
    }
  }
  return peak
}

/**
 * Linear interpolation from the dense FFT grid onto the plot grid.
 *
 * The grid is uniform, so a frequency maps straight onto a fractional index by
 * dividing by the bin spacing. `xlast` is the last bin, at index `len - 1`, so
 * the spacing is `xlast / (len - 1)`, and the index is `(len - 1) * f / xlast`.
 *
 * The Python this was ported from divided by the length instead, which stretched
 * every Conv curve along the frequency axis by len/(len-1), a fifth of a percent
 * with the usual 512 point half spectrum. That came from pycamilladsp-plot
 * commit e4867a1, which replaced `np.interp` with index arithmetic and took the
 * bin spacing from the wrong end of the fencepost. It is corrected here: a Conv
 * whose impulse sits at sample N now has a group delay of exactly N/fs, where
 * before it was 0.196% high at every frequency.
 */
function interpolate(y: Float64Array, xlast: number, xnew: ArrayLike<number>): Float64Array {
  const out = new Float64Array(xnew.length)
  const last = y.length - 1
  for (let n = 0; n < xnew.length; n++) {
    const idx = ((y.length - 1) * xnew[n]) / xlast
    const floor = Math.floor(idx)
    const fract = idx - floor
    const i1 = Math.min(floor, last)
    const i2 = Math.min(i1 + 1, last)
    out[n] = (1 - fract) * y[i1] + fract * y[i2]
  }
  return out
}

/**
 * Interpolate a complex curve in polar form.
 *
 * The phase has to be unwrapped on the dense FFT grid before it can be
 * interpolated, otherwise the wraps land between the sample points and the
 * interpolation runs straight through them.
 */
export function interpolatePolar(curve: ComplexCurve, xold: Float64Array, xnew: ArrayLike<number>): ComplexCurve {
  const npoints = curve.re.length
  const magnitude = new Float64Array(npoints)
  const wrapped = new Float64Array(npoints)
  for (let n = 0; n < npoints; n++) {
    magnitude[n] = Math.hypot(curve.re[n], curve.im[n])
    wrapped[n] = Math.atan2(curve.im[n], curve.re[n]) * (180.0 / Math.PI)
  }
  const unwrapped = unwrapPhase(wrapped, 270.0)
  for (let n = 0; n < npoints; n++) unwrapped[n] *= Math.PI / 180.0

  const xlast = xold[xold.length - 1]
  const magnitudeInterp = interpolate(magnitude, xlast, xnew)
  const angleInterp = interpolate(unwrapped, xlast, xnew)

  const out = zeroCurve(xnew.length)
  for (let n = 0; n < xnew.length; n++) {
    out.re[n] = magnitudeInterp[n] * Math.cos(angleInterp[n])
    out.im[n] = magnitudeInterp[n] * Math.sin(angleInterp[n])
  }
  return out
}

/**
 * The half spectrum of an impulse response, on the FFT's own linear frequency
 * grid.
 *
 * `removeDelay` rotates out the bulk delay, taken from the position of the
 * impulse peak, so that the phase plot of a linear phase filter stays readable
 * instead of wrapping thousands of times.
 */
export function convSpectrum(
  impulse: ArrayLike<number>,
  fs: number,
  removeDelay: boolean,
): { freq: Float64Array; curve: ComplexCurve } {
  // Zero padded to at least one bin per Hz, not merely to the length of the
  // impulse response. Padding costs nothing in accuracy, it evaluates the same
  // transform at more frequencies, and the plot needs those frequencies: its
  // log axis puts hundreds of points below 100 Hz, and a 2000 tap filter
  // padded only to its own length has 23 Hz bins, so the whole knee of a
  // highpass is drawn by interpolating across it. That was worth 4.7 dB of
  // error at the knee, falling fourfold for every doubling of the length.
  //
  // The cost lands where it is affordable. A filter long enough for the FFT to
  // be expensive already resolves better than a Hz, so nothing changes for it;
  // a short filter is padded a long way, but a 65k point transform is a few
  // milliseconds, once, and the result is cached.
  const npoints = Math.max(nextPow2(impulse.length), nextPow2(fs))
  const re = new Float64Array(npoints)
  const im = new Float64Array(npoints)
  re.set(impulse)
  fftInPlace(re, im)

  const half = npoints / 2
  const freq = new Float64Array(half)
  const curve = zeroCurve(half)
  for (let n = 0; n < half; n++) {
    freq[n] = (fs * n) / npoints
    curve.re[n] = re[n]
    curve.im[n] = im[n]
  }
  if (removeDelay) {
    const maxidx = findPeak(impulse)
    for (let n = 0; n < half; n++) {
      const angle = (1.0 / (npoints / 2)) * Math.PI * n * maxidx
      const wr = Math.cos(angle)
      const wi = Math.sin(angle)
      const r = curve.re[n] * wr - curve.im[n] * wi
      const i = curve.re[n] * wi + curve.im[n] * wr
      curve.re[n] = r
      curve.im[n] = i
    }
  }
  return { freq, curve }
}

/**
 * The transfer function of a convolution filter on the plot's frequency grid.
 *
 * The bulk delay is always taken out before the interpolation, whether or not
 * the caller wants it in the result, because interpolating the phase means
 * unwrapping it on the FFT grid first, and a peak sitting late in the impulse
 * response turns the phase by more than half a circle from one bin to the next,
 * which no unwrap can follow. Taking the peak out leaves a phase that barely
 * moves between bins. Where the caller wants the delay it goes back on
 * afterwards in closed form, which is exact at any length.
 */
export function convComplexGain(
  impulse: ArrayLike<number>,
  fs: number,
  freq: ArrayLike<number>,
  removeDelay = false,
): ComplexCurve {
  const spectrum = convSpectrum(impulse, fs, true)
  const curve = interpolatePolar(spectrum.curve, spectrum.freq, freq)
  if (!removeDelay) applyDelayInto(curve, findPeak(impulse) / fs, freq)
  return curve
}
