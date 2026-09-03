"""
The values CamillaDSP substitutes for optional config parameters it was not
given.

The schemas deliberately declare these as `default: null`, because null means
"not set" and lets the DSP apply its own default. So both the validator and
the filter evaluator have to know the real values, and this module is the one
place they are written down. Keep them in step with the accessor defaults in
CamillaDSP's `src/config/mod.rs`.
"""

import math

# GraphicEqualizerParameters::freq_min / freq_max
GRAPHIC_EQ_FREQ_MIN = 20.0
GRAPHIC_EQ_FREQ_MAX = 20000.0

# LoudnessParameters::high_boost / low_boost, in dB
LOUDNESS_HIGH_BOOST = 10.0
LOUDNESS_LOW_BOOST = 10.0

# LoudnessParameters::high_freq / low_freq, the shelf corner frequencies in Hz
LOUDNESS_HIGH_FREQ = 3500.0
LOUDNESS_LOW_FREQ = 70.0

# LoudnessParameters::high_q / low_q. This Q gives the same shelves as the fixed
# slope of 12 dB/octave that CamillaDSP used before the parameters existed.
LOUDNESS_HIGH_Q = 1.0 / math.sqrt(2.0)
LOUDNESS_LOW_Q = 1.0 / math.sqrt(2.0)

# GainParameters::scale
GAIN_SCALE = "dB"

# BiquadCombo NPointPeq: a band whose gain is no larger than this is left out
# when the filter is built, which is how a band is disabled without removing it.
# See BiquadCombo::make_npeq in src/filters/biquadcombo.rs.
NPOINT_PEQ_MIN_GAIN = 0.001
