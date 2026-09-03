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
 * The threshold bounds the prediction error, not the raw step. On smoothly
 * varying phase its exact value makes no difference. The only filter it
 * affects is a Notch, whose zero sits on the unit circle: the phase step
 * across the notch lands just under 180 degrees on a discrete frequency grid,
 * so a threshold of 180 would sit right on the boundary of a genuine 180
 * degree flip. Group delay is singular at the zero either way, and 150 is what
 * keeps the resulting spike positive rather than negative.
 */
export function unwrapPhase(values: ArrayLike<number>, threshold = 150.0): Float64Array {
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

/**
 * Group delay in ms, from a phase curve in degrees. Returned on the midpoints
 * of the frequency grid, so one point shorter than the input.
 */
export function calcGroupDelay(
  freq: ArrayLike<number>,
  phase: ArrayLike<number>,
): { freq: number[]; groupdelay: number[] } {
  if (freq.length < 2) return { freq: [], groupdelay: [] }
  const unwrapped = unwrapPhase(phase)
  const npoints = freq.length - 1
  const freqNew = new Array<number>(npoints)
  const groupdelay = new Array<number>(npoints)
  for (let n = 0; n < npoints; n++) {
    const dw = (freq[n + 1] - freq[n]) * 2 * Math.PI
    const dp = (unwrapped[n + 1] - unwrapped[n]) * (Math.PI / 180.0)
    freqNew[n] = (freq[n] + freq[n + 1]) / 2.0
    groupdelay[n] = (-1000.0 * dp) / dw
  }
  return { freq: freqNew, groupdelay }
}
