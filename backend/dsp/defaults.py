"""
The values CamillaDSP substitutes for optional config parameters it was not
given.

The schemas deliberately declare these as `default: null`, because null means
"not set" and lets the DSP apply its own default. So both the validator and
the filter evaluator have to know the real values, and this module is the one
place they are written down. Keep them in step with the accessor defaults in
CamillaDSP's `src/config/mod.rs`.
"""

# GraphicEqualizerParameters::freq_min / freq_max
GRAPHIC_EQ_FREQ_MIN = 20.0
GRAPHIC_EQ_FREQ_MAX = 20000.0

# LoudnessParameters::high_boost / low_boost, in dB
LOUDNESS_HIGH_BOOST = 10.0
LOUDNESS_LOW_BOOST = 10.0

# GainParameters::scale
GAIN_SCALE = "dB"
