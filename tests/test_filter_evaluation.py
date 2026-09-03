import math

import numpy as np
import pytest

from backend.dsp.defaults import LOUDNESS_LOW_Q
from backend.dsp.eval_filterconfig import eval_filter, eval_filterstep
from backend.dsp.filters import Biquad, BiquadCombo, Loudness, diffeq_is_stable


def _assert_eval_result_shape(result, npoints):
    assert "f" in result
    assert "magnitude" in result
    assert "phase" in result
    assert "f_groupdelay" in result
    assert "groupdelay" in result
    assert len(result["f"]) == npoints
    assert len(result["magnitude"]) == npoints
    assert len(result["phase"]) == npoints
    assert len(result["f_groupdelay"]) == npoints - 1
    assert len(result["groupdelay"]) == npoints - 1


# === Shelf Filters (value checks) ===

def test_eval_biquad_lowshelf_has_expected_low_and_high_frequency_gain():
    npoints = 300
    filterconf = {
        "type": "Biquad",
        "parameters": {
            "type": "Lowshelf",
            "freq": 1000.0,
            "q": 0.707,
            "gain": 6.0,
        },
    }

    result = eval_filter(filterconf, samplerate=48000, npoints=npoints)

    _assert_eval_result_shape(result, npoints)
    assert abs(result["magnitude"][0] - 6.0) < 0.4
    assert abs(result["magnitude"][-1] - 0.0) < 0.4


def test_eval_biquad_highshelf_has_expected_low_and_high_frequency_gain():
    npoints = 300
    filterconf = {
        "type": "Biquad",
        "parameters": {
            "type": "Highshelf",
            "freq": 1000.0,
            "q": 0.707,
            "gain": 6.0,
        },
    }

    result = eval_filter(filterconf, samplerate=48000, npoints=npoints)

    _assert_eval_result_shape(result, npoints)
    assert abs(result["magnitude"][0] - 0.0) < 0.4
    assert abs(result["magnitude"][-1] - 6.0) < 0.4


# === Other Biquad Types (smoke checks) ===

@pytest.mark.parametrize(
    "biquad_params",
    [
        {"type": "Lowpass", "freq": 1000.0, "q": 0.707},
        {"type": "Highpass", "freq": 1000.0, "q": 0.707},
        {"type": "Peaking", "freq": 1000.0, "q": 1.0, "gain": 3.0},
        {"type": "Notch", "freq": 1000.0, "q": 5.0},
        {
            "type": "GeneralNotch",
            "freq_p": 1200.0,
            "q_p": 2.0,
            "freq_z": 1000.0,
            "normalize_at_dc": False,
        },
        {"type": "Bandpass", "freq": 1000.0, "q": 2.0},
        {"type": "Allpass", "freq": 1000.0, "q": 0.9},
        {"type": "AllpassFO", "freq": 1000.0},
        {"type": "LowpassFO", "freq": 1000.0},
        {"type": "HighpassFO", "freq": 1000.0},
        {"type": "LowshelfFO", "freq": 1000.0, "gain": 3.0},
        {"type": "HighshelfFO", "freq": 1000.0, "gain": 3.0},
        {
            "type": "LinkwitzTransform",
            "freq_act": 60.0,
            "q_act": 0.7,
            "freq_target": 30.0,
            "q_target": 0.8,
        },
        {
            "type": "Free",
            "a1": -0.5,
            "a2": 0.2,
            "b0": 1.0,
            "b1": 0.0,
            "b2": 0.0,
        },
    ],
)
def test_eval_biquad_other_types_return_result_without_exceptions(biquad_params):
    npoints = 128
    result = eval_filter(
        {"type": "Biquad", "parameters": biquad_params},
        samplerate=48000,
        npoints=npoints,
    )
    _assert_eval_result_shape(result, npoints)


# === BiquadCombo Filters ===

def test_eval_biquadcombo_graphic_equalizer_with_zero_gains_is_flat():
    npoints = 200
    filterconf = {
        "type": "BiquadCombo",
        "parameters": {
            "type": "GraphicEqualizer",
            "freq_min": 20.0,
            "freq_max": 20000.0,
            "gains": [0.0, 0.0, 0.0, 0.0, 0.0],
        },
    }

    result = eval_filter(filterconf, samplerate=48000, npoints=npoints)

    _assert_eval_result_shape(result, npoints)
    assert max(abs(value) for value in result["magnitude"]) < 1e-6


def test_eval_biquadcombo_tilt_positive_gain_tilts_up_towards_high_frequencies():
    npoints = 300
    filterconf = {
        "type": "BiquadCombo",
        "parameters": {
            "type": "Tilt",
            "gain": 10.0,
        },
    }

    result = eval_filter(filterconf, samplerate=48000, npoints=npoints)

    _assert_eval_result_shape(result, npoints)
    assert result["magnitude"][0] < -1.0
    assert result["magnitude"][-1] > 1.0


@pytest.mark.parametrize(
    "combo_params",
    [
        {"type": "ButterworthHighpass", "freq": 1000.0, "order": 4},
        {"type": "ButterworthLowpass", "freq": 1000.0, "order": 4},
        {"type": "LinkwitzRileyHighpass", "freq": 1000.0, "order": 4},
        {"type": "LinkwitzRileyLowpass", "freq": 1000.0, "order": 4},
        {
            "type": "NPointPeq",
            "bands": [
                {"freq": 80.0, "q": 0.7, "gain": 1.0},
                {"freq": 200.0, "q": 1.0, "gain": -1.0},
                {"freq": 800.0, "q": 1.0, "gain": 0.5},
                {"freq": 2400.0, "q": 1.0, "gain": -0.5},
                {"freq": 6000.0, "q": 0.7, "gain": 1.0},
            ],
        },
        # Only the two shelves, the minimum a NPointPeq can have
        {
            "type": "NPointPeq",
            "bands": [
                {"freq": 100.0, "q": 0.7, "gain": 2.0},
                {"freq": 5000.0, "q": 0.7, "gain": -2.0},
            ],
        },
        # Every band disabled by zero gain, so no biquads are built at all
        {
            "type": "NPointPeq",
            "bands": [
                {"freq": 100.0, "q": 0.7, "gain": 0.0},
                {"freq": 5000.0, "q": 0.7, "gain": 0.0},
            ],
        },
    ],
)
def test_eval_biquadcombo_other_types_return_result_without_exceptions(combo_params):
    npoints = 128
    result = eval_filter(
        {"type": "BiquadCombo", "parameters": combo_params},
        samplerate=48000,
        npoints=npoints,
    )
    _assert_eval_result_shape(result, npoints)


# === Conv Filters ===

def test_eval_conv_identity_values_is_flat_and_returns_impulse_data():
    npoints = 128
    filterconf = {
        "type": "Conv",
        "parameters": {
            "type": "Values",
            "values": [1.0],
        },
    }

    result = eval_filter(filterconf, samplerate=48000, npoints=npoints)

    _assert_eval_result_shape(result, npoints)
    assert "time" in result
    assert "impulse" in result
    assert result["impulse"] == [1.0]
    assert len(result["time"]) == 1
    assert max(abs(value) for value in result["magnitude"]) < 1e-6


def test_eval_conv_two_tap_values_returns_result_without_exceptions():
    npoints = 128
    filterconf = {
        "type": "Conv",
        "parameters": {
            "type": "Values",
            "values": [0.5, 0.5],
        },
    }

    result = eval_filter(filterconf, samplerate=48000, npoints=npoints)

    _assert_eval_result_shape(result, npoints)
    assert "time" in result
    assert "impulse" in result
    assert result["impulse"] == [0.5, 0.5]
    assert len(result["time"]) == 2

def test_filterstep_includes_loudness():
    """
    A Loudness filter has a real frequency response and must contribute to the
    step it sits in. It used to be skipped, so the step plotted flat.
    """
    conf = {
        "devices": {"samplerate": 48000},
        "filters": {
            "loud": {
                "type": "Loudness",
                "parameters": {"reference_level": 0.0, "fader": "Main"},
            }
        },
        "pipeline": [{"type": "Filter", "channels": [0], "names": ["loud"]}],
    }
    boosted = eval_filterstep(conf, 0, npoints=100, volume=-40.0)
    assert max(boosted["magnitude"]) > 1.0

    # At the reference level the loudness boost is zero, so the step is flat.
    flat = eval_filterstep(conf, 0, npoints=100, volume=0.0)
    assert max(abs(g) for g in flat["magnitude"]) < 0.01


def test_filterstep_includes_flat_types():
    """Volume, Dither and Clipper are flat, but must not break the step."""
    conf = {
        "devices": {"samplerate": 48000},
        "filters": {
            "vol": {"type": "Volume", "parameters": {"fader": "Aux1"}},
            "dith": {"type": "Dither", "parameters": {"type": "Flat", "bits": 16}},
            "clip": {"type": "Clipper", "parameters": {"clip_limit": -3.0}},
        },
        "pipeline": [
            {"type": "Filter", "channels": [0], "names": ["vol", "dith", "clip"]}
        ],
    }
    result = eval_filterstep(conf, 0, npoints=100)
    assert max(abs(g) for g in result["magnitude"]) < 0.01


def test_filterstep_rejects_unknown_filter_type():
    """An unplottable filter is reported, not silently dropped from the step."""
    conf = {
        "devices": {"samplerate": 48000},
        "filters": {"bogus": {"type": "NotAFilter", "parameters": {}}},
        "pipeline": [{"type": "Filter", "channels": [0], "names": ["bogus"]}],
    }
    with pytest.raises(ValueError, match="Unknown filter type NotAFilter"):
        eval_filterstep(conf, 0, npoints=100)


# === Vectorised evaluation ===


def test_eval_results_are_plain_python_types():
    """
    Evaluation is vectorised with numpy, but the results go straight into a
    JSON response, which cannot encode numpy types.
    """
    import json

    for params in ({"type": "Values", "values": [1.0, 0.5, 0.25]},
                   {"type": "Dummy", "length": 256}):
        result = eval_filter(
            {"type": "Conv", "parameters": params}, samplerate=48000, npoints=50
        )
        json.dumps(result)  # raises TypeError on a numpy type
        for key in ("f", "magnitude", "phase", "groupdelay", "impulse", "time"):
            assert isinstance(result[key], list), key
            assert all(isinstance(v, float) for v in result[key]), key

    conf = {
        "devices": {"samplerate": 48000},
        "filters": {"b": {"type": "Biquad",
                          "parameters": {"type": "Lowpass", "freq": 1000, "q": 0.7}}},
        "pipeline": [{"type": "Filter", "channels": [0], "names": ["b"]}],
    }
    step = eval_filterstep(conf, 0, npoints=50)
    json.dumps(step)
    assert all(isinstance(v, float) for v in step["magnitude"])


def test_conv_find_peak_picks_the_last_of_equal_peaks():
    """
    find_peak used to be a max() over (magnitude, index) pairs, which returns
    the highest index when several samples tie. np.argmax returns the first,
    so the search is done on the reversed array to keep the old behaviour.
    """
    from backend.dsp.filters import Conv

    assert Conv({"values": [0.0, 1.0, 0.0, 1.0, 0.0]}, 48000).find_peak() == 3
    assert Conv({"values": [0.0, 0.5, 1.0, 0.5]}, 48000).find_peak() == 2
    assert Conv({"values": [1.0, 0.0, -1.0]}, 48000).find_peak() == 2


def test_unwrap_phase_follows_a_steep_but_smooth_slope():
    """
    The predictive term is the reason this is not numpy.unwrap: it tracks a
    phase advancing well beyond 180 degrees per point, which numpy.unwrap
    cannot do by construction.
    """
    import numpy as np
    from backend.dsp.filters import unwrap_phase

    # slope grows gradually from 1 to 300 degrees per point
    truth = -np.cumsum(np.linspace(1.0, 300.0, 600))
    wrapped = (truth + 180.0) % 360.0 - 180.0

    ours = np.array(unwrap_phase(list(wrapped)))
    ours -= ours[0]
    reference = truth - truth[0]
    assert np.abs(ours - reference).max() < 1.0

    # numpy.unwrap loses it as soon as the slope passes 180 deg/point
    theirs = np.unwrap(wrapped, discont=150.0, period=360.0)
    theirs -= theirs[0]
    assert np.abs(theirs - reference).max() > 1000.0



def test_npointpeq_assigns_band_roles_by_position():
    # First band is a low shelf, last a high shelf, the ones between are peaking.
    bands = [
        {"freq": 100.0, "q": 0.7, "gain": 3.0},
        {"freq": 1000.0, "q": 1.0, "gain": -2.0},
        {"freq": 5000.0, "q": 0.7, "gain": 4.0},
    ]
    combo = BiquadCombo({"type": "NPointPeq", "bands": bands}, 48000)
    expected = [
        Biquad({"freq": 100.0, "q": 0.7, "gain": 3.0, "type": "Lowshelf"}, 48000),
        Biquad({"freq": 1000.0, "q": 1.0, "gain": -2.0, "type": "Peaking"}, 48000),
        Biquad({"freq": 5000.0, "q": 0.7, "gain": 4.0, "type": "Highshelf"}, 48000),
    ]

    freq = np.geomspace(10.0, 20000.0, 200)
    _f, actual = combo.complex_gain(freq)
    reference = np.ones(len(freq), dtype=complex)
    for biquad in expected:
        reference = reference * biquad.complex_gain(freq)[1]

    assert np.allclose(actual, reference)


def test_npointpeq_leaves_out_bands_with_no_significant_gain():
    # Matches BiquadCombo::make_npeq, which skips a band with |gain| <= 0.001.
    # That is how a band is disabled without removing it from the list.
    def biquad_count(middle_gain):
        bands = [
            {"freq": 100.0, "q": 0.7, "gain": 3.0},
            {"freq": 1000.0, "q": 1.0, "gain": middle_gain},
            {"freq": 5000.0, "q": 0.7, "gain": 4.0},
        ]
        return len(BiquadCombo({"type": "NPointPeq", "bands": bands}, 48000).biquads)

    assert biquad_count(0.001) == 2
    assert biquad_count(-0.001) == 2
    assert biquad_count(0.0011) == 3


def test_npointpeq_with_every_band_disabled_is_flat():
    bands = [
        {"freq": 100.0, "q": 0.7, "gain": 0.0},
        {"freq": 5000.0, "q": 0.7, "gain": 0.0},
    ]
    combo = BiquadCombo({"type": "NPointPeq", "bands": bands}, 48000)

    freq = np.geomspace(10.0, 20000.0, 100)
    _f, gain = combo.complex_gain(freq)

    assert combo.biquads == []
    assert np.allclose(gain, 1.0)


def _loudness_reference(conf, volume, freq, samplerate=48000):
    """The two shelves as CamillaDSP builds them, see src/filters/loudness.rs."""
    rel_boost = min(max(-(volume - conf["reference_level"]) / 20.0, 0.0), 1.0)
    shelves = [
        Biquad(
            {
                "freq": conf.get("low_freq", 70.0),
                "q": conf.get("low_q", 1.0 / math.sqrt(2.0)),
                "gain": rel_boost * conf.get("low_boost", 10.0),
                "type": "Lowshelf",
            },
            samplerate,
        ),
        Biquad(
            {
                "freq": conf.get("high_freq", 3500.0),
                "q": conf.get("high_q", 1.0 / math.sqrt(2.0)),
                "gain": rel_boost * conf.get("high_boost", 10.0),
                "type": "Highshelf",
            },
            samplerate,
        ),
    ]
    gain = np.ones(len(freq), dtype=complex)
    for shelf in shelves:
        gain = gain * shelf.complex_gain(freq)[1]
    return gain


@pytest.mark.parametrize(
    "params",
    [
        {"reference_level": 0.0},
        {"reference_level": 0.0, "low_freq": 120.0, "high_freq": 6000.0},
        {"reference_level": 0.0, "low_q": 0.4, "high_q": 1.5},
        {
            "reference_level": 0.0,
            "low_freq": 150.0,
            "low_q": 1.8,
            "high_freq": 8000.0,
            "high_q": 0.3,
        },
    ],
)
def test_loudness_shelves_match_the_dsp(params):
    freq = np.geomspace(10.0, 20000.0, 400)
    evaluated = Loudness(dict(params), 48000, -20.0).complex_gain(freq)[1]

    assert np.allclose(evaluated, _loudness_reference(params, -20.0, freq))


def test_loudness_treats_an_explicit_null_as_not_set():
    # The schema fills the optional parameters in as nulls, which must fall back
    # to CamillaDSP's defaults exactly like a missing key does.
    freq = np.geomspace(10.0, 20000.0, 200)
    with_nulls = {
        "reference_level": 0.0,
        "high_freq": None,
        "low_freq": None,
        "high_q": None,
        "low_q": None,
    }

    assert np.allclose(
        Loudness(with_nulls, 48000, -20.0).complex_gain(freq)[1],
        Loudness({"reference_level": 0.0}, 48000, -20.0).complex_gain(freq)[1],
    )


def test_loudness_default_q_equals_the_old_fixed_slope():
    # Before high_q/low_q existed the shelves used a fixed 12 dB/octave slope.
    # The default Q has to reproduce that, or every existing config changes shape.
    freq = np.geomspace(10.0, 20000.0, 400)
    for boost in (1.0, 5.0, 10.0, 20.0):
        by_slope = Biquad(
            {"freq": 70.0, "slope": 12.0, "gain": boost, "type": "Lowshelf"}, 48000
        )
        by_q = Biquad(
            {"freq": 70.0, "q": LOUDNESS_LOW_Q, "gain": boost, "type": "Lowshelf"},
            48000,
        )

        assert np.allclose(by_slope.complex_gain(freq)[1], by_q.complex_gain(freq)[1])


def _schur_cohn(a):
    """
    Port of `poles_inside_unit_circle` from CamillaDSP's src/filters/diffeq.rs,
    used here only as an independent reference for diffeq_is_stable.
    """
    coeffs = list(a)
    for order in range(len(coeffs) - 1, 0, -1):
        reflection = coeffs[order]
        if abs(reflection) >= 1.0:
            return False
        scale = 1.0 - reflection * reflection
        prev = list(coeffs)
        for n in range(1, order):
            coeffs[n] = (prev[n] - reflection * prev[order - n]) / scale
        coeffs = coeffs[:order]
    return True


def test_diffeq_is_stable_agrees_with_the_dsp_algorithm():
    # The DSP uses Schur-Cohn to avoid root finding, the GUI uses np.roots.
    # They must reach the same verdict, including near the unit circle.
    rng = np.random.default_rng(0)
    for order in range(1, 9):
        for _ in range(500):
            spread = 1.15 if rng.random() < 0.5 else 1.001
            a = np.poly(rng.uniform(-spread, spread, order))

            assert diffeq_is_stable(a) == _schur_cohn(list(a)), list(a)


@pytest.mark.parametrize(
    "a,expected",
    [
        ([], True),
        ([1.0], True),
        ([1.0, 0.0], True),
        ([1.0, -2.0, 1.0], False),
        ([1.0, 0.0, -1.0], False),
        ([1.0, -1.9999999, 0.99999999], True),
    ],
)
def test_diffeq_is_stable_boundary_cases(a, expected):
    assert diffeq_is_stable(a) is expected
