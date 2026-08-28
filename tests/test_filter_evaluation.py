import pytest

from backend.dsp.eval_filterconfig import eval_filter, eval_filterstep


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
            "type": "FivePointPeq",
            "fls": 80.0,
            "fp1": 200.0,
            "fp2": 800.0,
            "fp3": 2400.0,
            "fhs": 6000.0,
            "qls": 0.7,
            "qp1": 1.0,
            "qp2": 1.0,
            "qp3": 1.0,
            "qhs": 0.7,
            "gls": 1.0,
            "gp1": -1.0,
            "gp2": 0.5,
            "gp3": -0.5,
            "ghs": 1.0,
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
