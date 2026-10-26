/**
 * The values CamillaDSP substitutes for optional config parameters it was not
 * given.
 *
 * The schemas deliberately declare these as `default: null`, because null means
 * "not set" and lets the DSP apply its own default. So the evaluator has to
 * know the real values. Keep them in step with the accessor defaults in
 * CamillaDSP's `src/config/mod.rs`, and with `backend/dsp/defaults.py`, which
 * still holds the ones the validator needs.
 */

/** GraphicEqualizerParameters::freq_min / freq_max */
export const GRAPHIC_EQ_FREQ_MIN = 20.0
export const GRAPHIC_EQ_FREQ_MAX = 20000.0

/** LoudnessParameters::high_boost / low_boost, in dB */
export const LOUDNESS_HIGH_BOOST = 10.0
export const LOUDNESS_LOW_BOOST = 10.0

/** LoudnessParameters::high_freq / low_freq, the shelf corner frequencies in Hz */
export const LOUDNESS_HIGH_FREQ = 3500.0
export const LOUDNESS_LOW_FREQ = 70.0

/**
 * LoudnessParameters::high_q / low_q. This Q gives the same shelves as the
 * fixed slope of 12 dB/octave that CamillaDSP used before the parameters
 * existed.
 */
export const LOUDNESS_HIGH_Q = 1.0 / Math.sqrt(2.0)
export const LOUDNESS_LOW_Q = 1.0 / Math.sqrt(2.0)

/** GainParameters::scale */
export const GAIN_SCALE = "dB"

/**
 * BiquadCombo NPointPeq: a band whose gain is no larger than this is left out
 * when the filter is built, which is how a band is disabled without removing
 * it. See BiquadCombo::make_npeq in src/filters/biquadcombo.rs.
 */
export const NPOINT_PEQ_MIN_GAIN = 0.001
