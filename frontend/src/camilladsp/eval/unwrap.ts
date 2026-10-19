/**
 * Phase unwrapping.
 *
 * Only for making a convolution filter's phase continuous on the FFT grid
 * before it is interpolated onto the plot grid. The group delay does not come
 * through here: it is computed from the coefficients instead, see
 * `groupdelay.ts`.
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
 * grid.
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
