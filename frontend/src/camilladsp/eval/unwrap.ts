/**
 * Phase unwrapping and group delay.
 */

/**
 * Unwrap a phase curve given in degrees.
 *
 * Unlike the usual unwrap, this predicts each value from the previous one plus
 * the last known slope, and measures the jump against that prediction. That
 * lets it follow a phase that advances by more than 180 degrees per point, as
 * a filter with a large delay does, as long as the slope changes gradually. An
 * unwrap that compares raw steps against 180 degrees is limited to 180 degrees
 * per point by construction, so it is not a replacement.
 *
 * The threshold bounds the prediction error, not the raw step, so on smoothly
 * varying phase its exact value makes little difference.
 *
 * This is used for one thing: making a convolution filter's phase continuous
 * on the FFT's own uniform grid, so that it can be interpolated onto the plot
 * grid. Group delay does not go through here, it differentiates the phase
 * directly, see `calcGroupDelay`.
 */
export function unwrapPhase(values: ArrayLike<number>, threshold: number): Float64Array {
  const unwrapped = new Float64Array(values.length)
  if (values.length === 0) return unwrapped
  let offset = 0
  let prevdiff = 0.0
  unwrapped[0] = values[0]
  for (let n = 1; n < values.length; n++) {
    const guess = values[n - 1] + prevdiff
    const diff = values[n] - guess
    let jumped: boolean
    if (diff > threshold) {
      offset -= 1
      jumped = true
    } else if (diff < -threshold) {
      offset += 1
      jumped = true
    } else {
      jumped = false
    }
    unwrapped[n] = values[n] + 2 * 180.0 * offset
    if (!jumped) prevdiff = unwrapped[n] - unwrapped[n - 1]
  }
  return unwrapped
}

/** The middle of three values. */
function median3(values: number[]): number {
  const [a, b, c] = values
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
}

/**
 * Group delay in ms, from a phase curve in degrees. Returned on the midpoints
 * of the frequency grid, so one point shorter than the input.
 *
 * The phase is differentiated directly rather than unwrapped first. Only the
 * step between two neighbouring points matters here, and a step is known
 * modulo a full turn, so the whole turns are chosen to land as close as
 * possible to the group delay just below in frequency. Group delay varies
 * slowly with frequency where it means anything at all, which makes it a far
 * better thing to predict than the phase itself: on the log grid the plots
 * use, the phase step at 20 kHz is hundreds of times the step at 10 Hz, so a
 * filter with any real delay in it turns through several whole circles between
 * neighbouring points at the top of the range. Unwrapping the phase first got
 * that wrong for anything past about 10 ms, and got it wrong cumulatively,
 * because an unwrap carries its error forward into every later point.
 *
 * What cannot be resolved either way is a group delay that changes by more
 * than half a turn of phase between two points, which is 1/(2*df). That is
 * 3 ms at the top of the plot grid, and it is a bound on the *change*, not on
 * the delay: a constant delay of any size comes out exact.
 *
 * A phase of NaN, which is how a response too deep to be readable is marked,
 * gives a group delay of NaN either side of it and is left out of the
 * prediction, so the curve carries on correctly after the gap.
 */
export function calcGroupDelay(
  freq: ArrayLike<number>,
  phase: ArrayLike<number>,
): { freq: number[]; groupdelay: number[] } {
  if (freq.length < 2) return { freq: [], groupdelay: [] }
  const npoints = freq.length - 1
  const freqNew = new Array<number>(npoints)
  const groupdelay = new Array<number>(npoints)
  // The prediction is the median of the last three, not simply the last one.
  // A filter with a zero on the unit circle, a Notch or a null in a convolution
  // filter's response, has a genuinely singular group delay at that frequency,
  // and predicting the next point from that one spike would put a whole turn
  // into every point after it, which the curve would then never recover from.
  // A median steps over a single wild point and keeps the curve either side of
  // it right. Seeded with zeros, which is safe: the grid is finest at its low
  // end, where the phase of even a very long delay moves by a fraction of a
  // degree between points.
  const recent = [0.0, 0.0, 0.0]
  let accepted = 0
  for (let n = 0; n < npoints; n++) {
    freqNew[n] = (freq[n] + freq[n + 1]) / 2.0
    const measured = phase[n + 1] - phase[n]
    if (!Number.isFinite(measured)) {
      // a blanked phase, too deep below the passband to be readable. There is
      // no group delay across it, and it must not teach the prediction
      // anything either.
      groupdelay[n] = NaN
      continue
    }
    const dw = (freq[n + 1] - freq[n]) * 2 * Math.PI
    const predicted = (-median3(recent) / 1000.0) * dw * (180.0 / Math.PI)
    const step = measured + 360.0 * Math.round((predicted - measured) / 360.0)
    groupdelay[n] = (-1000.0 * step * (Math.PI / 180.0)) / dw
    recent[accepted % 3] = groupdelay[n]
    accepted++
  }
  return { freq: freqNew, groupdelay }
}
