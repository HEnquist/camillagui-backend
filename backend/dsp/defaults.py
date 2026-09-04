"""
The values CamillaDSP substitutes for optional config parameters it was not
given.

The schemas deliberately declare these as `default: null`, because null means
"not set" and lets the DSP apply its own default. So the validator has to know
the real values, and this module is where they are written down. Keep them in
step with the accessor defaults in CamillaDSP's `src/config/mod.rs`.

Filter evaluation needs more of these than the validator does. It runs in the
browser now, and its copy lives in `camillagui/src/camilladsp/eval/defaults.ts`.
"""

# GraphicEqualizerParameters::freq_min / freq_max
GRAPHIC_EQ_FREQ_MIN = 20.0
GRAPHIC_EQ_FREQ_MAX = 20000.0

# LoudnessParameters::high_freq / low_freq, the shelf corner frequencies in Hz
LOUDNESS_HIGH_FREQ = 3500.0
LOUDNESS_LOW_FREQ = 70.0
