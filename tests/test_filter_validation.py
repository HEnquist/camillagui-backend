import pytest

from backend.dsp.validate_config import CamillaValidator


def _base_config():
    return {
        "devices": {
            "samplerate": 48000,
            "chunksize": 1024,
            "capture": {
                "type": "Alsa",
                "device": "hw:0",
                "channels": 2,
                "format": "S16_LE",
            },
            "playback": {
                "type": "Alsa",
                "device": "hw:0",
                "channels": 2,
                "format": "S16_LE",
            },
        },
        "filters": {},
    }


def _validate(config):
    validator = CamillaValidator()
    validator.validate_config(config)
    issues = validator.get_errors()
    errors = [(path, message) for path, message, severity in issues if severity == "error"]
    warnings = [(path, message) for path, message, severity in issues if severity == "warning"]
    return errors, warnings


def _error_messages(errors):
    return [message for _path, message in errors]


# === Baseline Valid Case ===

def test_filter_validation_accepts_valid_biquad():
    config = _base_config()
    config["filters"]["lp"] = {
        "type": "Biquad",
        "parameters": {"type": "Lowpass", "freq": 1000.0, "q": 0.707},
    }

    errors, warnings = _validate(config)

    assert errors == []
    assert warnings == []


# === Biquad and BiquadCombo Rules ===

def test_filter_validation_rejects_frequency_at_nyquist():
    config = _base_config()
    config["filters"]["lp"] = {
        "type": "Biquad",
        "parameters": {"type": "Lowpass", "freq": 24000.0, "q": 0.707},
    }

    errors, _warnings = _validate(config)

    assert "Frequency must be < samplerate/2" in _error_messages(errors)


def test_filter_validation_rejects_unstable_free_biquad():
    config = _base_config()
    config["filters"]["free"] = {
        "type": "Biquad",
        "parameters": {
            "type": "Free",
            "a1": 2.0,
            "a2": 0.5,
            "b0": 1.0,
            "b1": 0.0,
            "b2": 0.0,
        },
    }

    errors, _warnings = _validate(config)

    assert "Filter is unstable" in _error_messages(errors)


def test_filter_validation_requires_one_of_q_or_bandwidth():
    config = _base_config()
    config["filters"]["bp"] = {
        "type": "Biquad",
        "parameters": {"type": "Bandpass", "freq": 1000.0},
    }

    errors, _warnings = _validate(config)

    assert "Missing 'bandwidth' or 'q', one must be given" in _error_messages(errors)


def test_filter_validation_rejects_both_q_and_bandwidth():
    config = _base_config()
    config["filters"]["bp"] = {
        "type": "Biquad",
        "parameters": {
            "type": "Bandpass",
            "freq": 1000.0,
            "q": 0.7,
            "bandwidth": 1.0,
        },
    }

    errors, _warnings = _validate(config)

    assert "Both 'bandwidth' and 'q' given, only one is allowed" in _error_messages(errors)


def test_filter_validation_requires_one_of_q_or_slope_for_shelves():
    config = _base_config()
    config["filters"]["hs"] = {
        "type": "Biquad",
        "parameters": {"type": "Highshelf", "freq": 2000.0, "gain": 3.0},
    }

    errors, _warnings = _validate(config)

    assert "Missing 'slope' or 'q', one must be given" in _error_messages(errors)


def test_filter_validation_rejects_invalid_graphic_eq_range():
    config = _base_config()
    config["filters"]["geq"] = {
        "type": "BiquadCombo",
        "parameters": {
            "type": "GraphicEqualizer",
            "freq_min": 1000.0,
            "freq_max": 100.0,
            "gains": [0.0, 1.0, -1.0],
        },
    }

    errors, _warnings = _validate(config)

    assert "Invalid range, 'freq_max' must be larger than 'freq_min'" in _error_messages(
        errors
    )


def test_filter_validation_checks_default_graphic_eq_freq_against_nyquist():
    # freq_max left out means the CamillaDSP default of 20000, which the
    # DSP rejects when the samplerate is too low to fit it
    config = _base_config()
    config["filters"]["geq"] = {
        "type": "BiquadCombo",
        "parameters": {
            "type": "GraphicEqualizer",
            "gains": [0.0, 1.0, -1.0],
        },
    }

    errors, _warnings = _validate(config)
    assert not errors

    config["devices"]["samplerate"] = 32000
    config["filters"]["geq"]["parameters"].pop("freq_max", None)
    config["filters"]["geq"]["parameters"].pop("freq_min", None)

    errors, _warnings = _validate(config)
    assert "Frequency must be < samplerate/2" in _error_messages(errors)


# === Convolution Coefficient File Rules ===

def test_filter_validation_rejects_missing_conv_file():
    config = _base_config()
    config["filters"]["conv"] = {
        "type": "Conv",
        "parameters": {
            "type": "Raw",
            "filename": "this_file_does_not_exist.txt",
            "format": "TEXT",
        },
    }

    errors, warnings = _validate(config)

    assert errors == []
    assert any("Unable to find coefficient file" in message for _path, message in warnings)


def test_filter_validation_rejects_invalid_wav_coeff_file(monkeypatch):
    coeff_file = "coeffs.wav"
    monkeypatch.setattr("backend.dsp.validate_config.os.path.exists", lambda _path: True)
    monkeypatch.setattr("backend.dsp.validate_config.read_wav_header", lambda _path: None)

    config = _base_config()
    config["filters"]["conv"] = {
        "type": "Conv",
        "parameters": {
            "type": "Wav",
            "filename": coeff_file,
            "channel": 0,
        },
    }

    errors, warnings = _validate(config)

    assert f"Invalid or unsupported wav file '{coeff_file}'" in _error_messages(errors)
    assert warnings == []


def test_filter_validation_rejects_empty_text_coeff_file(monkeypatch):
    coeff_file = "coeffs.txt"
    monkeypatch.setattr("backend.dsp.validate_config.os.path.exists", lambda _path: True)
    monkeypatch.setattr(
        "backend.dsp.validate_config.read_text_coeffs", lambda *_args, **_kwargs: []
    )

    config = _base_config()
    config["filters"]["conv"] = {
        "type": "Conv",
        "parameters": {
            "type": "Raw",
            "filename": coeff_file,
            "format": "TEXT",
        },
    }

    errors, _warnings = _validate(config)

    assert f"File '{coeff_file}' contains no values" in _error_messages(errors)


def test_filter_validation_accepts_text_coeff_file_with_values(monkeypatch):
    coeff_file = "coeffs.txt"
    monkeypatch.setattr("backend.dsp.validate_config.os.path.exists", lambda _path: True)
    monkeypatch.setattr(
        "backend.dsp.validate_config.read_text_coeffs",
        lambda *_args, **_kwargs: [1.0, 0.5],
    )

    config = _base_config()
    config["filters"]["conv"] = {
        "type": "Conv",
        "parameters": {
            "type": "Raw",
            "filename": coeff_file,
            "format": "TEXT",
        },
    }

    errors, warnings = _validate(config)

    assert errors == []
    assert warnings == []


def test_filter_validation_accepts_wav_coeff_file(monkeypatch):
    coeff_file = "coeffs.wav"
    monkeypatch.setattr("backend.dsp.validate_config.os.path.exists", lambda _path: True)
    monkeypatch.setattr(
        "backend.dsp.validate_config.read_wav_header",
        lambda _path: {"channels": 2, "samplerate": 48000},
    )

    config = _base_config()
    config["filters"]["conv"] = {
        "type": "Conv",
        "parameters": {
            "type": "Wav",
            "filename": coeff_file,
            "channel": 1,
        },
    }

    errors, warnings = _validate(config)

    assert errors == []
    assert warnings == []


def test_filter_validation_reports_issue_severity(monkeypatch):
    monkeypatch.setattr("backend.dsp.validate_config.os.path.exists", lambda _path: False)

    config = _base_config()
    config["filters"]["conv"] = {
        "type": "Conv",
        "parameters": {
            "type": "Raw",
            "filename": "missing_coeffs.txt",
            "format": "TEXT",
        },
    }

    validator = CamillaValidator()
    validator.validate_config(config)
    issues = validator.get_errors()

    assert len(issues) > 0
    assert all(len(issue) == 3 for issue in issues)
    assert any(issue[2] == "warning" for issue in issues)


# === LookaheadLimiter Rules ===

def _lookahead_limiter(**overrides):
    parameters = {
        "attack": 2.0,
        "attack_unit": "ms",
        "release": 100.0,
        "release_unit": "ms",
    }
    parameters.update(overrides)
    return {"type": "LookaheadLimiter", "parameters": parameters}


def test_filter_validation_accepts_lookahead_limiter_without_limit():
    config = _base_config()
    config["filters"]["lim"] = _lookahead_limiter()

    errors, warnings = _validate(config)

    assert errors == []
    assert warnings == []
    # The DSP takes limit as a plain f64 defaulting to 0.0, so filling in a
    # null here would produce a config CamillaDSP refuses.
    assert config["filters"]["lim"]["parameters"]["limit"] == 0.0


def test_filter_validation_rejects_lookahead_limiter_null_limit():
    config = _base_config()
    config["filters"]["lim"] = _lookahead_limiter(limit=None)

    errors, _warnings = _validate(config)

    assert errors != []


def test_filter_validation_rejects_lookahead_limiter_positive_limit():
    config = _base_config()
    config["filters"]["lim"] = _lookahead_limiter(limit=3.0)

    errors, _warnings = _validate(config)

    assert errors != []


def test_filter_validation_accepts_lookahead_limiter_zero_attack_and_release():
    config = _base_config()
    config["filters"]["lim"] = _lookahead_limiter(attack=0.0, release=0.0)

    errors, warnings = _validate(config)

    assert errors == []
    assert warnings == []


def test_filter_validation_rejects_lookahead_limiter_missing_units():
    config = _base_config()
    filt = _lookahead_limiter()
    del filt["parameters"]["attack_unit"]
    del filt["parameters"]["release_unit"]
    config["filters"]["lim"] = filt

    errors, _warnings = _validate(config)

    assert errors != []


def _npeq_config(bands, samplerate=48000):
    config = _base_config()
    config["devices"]["samplerate"] = samplerate
    config["filters"]["peq"] = {
        "type": "BiquadCombo",
        "parameters": {"type": "NPointPeq", "bands": bands},
    }
    return config


def test_filter_validation_accepts_npointpeq_with_rising_frequencies():
    config = _npeq_config(
        [
            {"freq": 100.0, "q": 0.7, "gain": 3.0},
            {"freq": 1000.0, "q": 1.0, "gain": -2.0},
            {"freq": 5000.0, "q": 0.7, "gain": 4.0},
        ]
    )

    errors, _warnings = _validate(config)

    assert errors == []


def test_filter_validation_accepts_npointpeq_with_only_the_two_shelves():
    config = _npeq_config(
        [
            {"freq": 100.0, "q": 0.7, "gain": 3.0},
            {"freq": 5000.0, "q": 0.7, "gain": -3.0},
        ]
    )

    errors, _warnings = _validate(config)

    assert errors == []


def test_filter_validation_rejects_npointpeq_with_a_single_band():
    # The first band is the low shelf and the last the high shelf,
    # so two is the minimum.
    config = _npeq_config([{"freq": 100.0, "q": 0.7, "gain": 3.0}])

    errors, _warnings = _validate(config)

    assert any("too short" in message for message in _error_messages(errors))


def test_filter_validation_rejects_npointpeq_with_decreasing_frequency():
    config = _npeq_config(
        [
            {"freq": 1000.0, "q": 0.7, "gain": 3.0},
            {"freq": 100.0, "q": 0.7, "gain": -2.0},
        ]
    )

    errors, _warnings = _validate(config)

    assert "Band frequencies must not decrease along the list" in _error_messages(errors)


def test_filter_validation_reports_the_band_that_drops_in_frequency():
    config = _npeq_config(
        [
            {"freq": 100.0, "q": 0.7, "gain": 3.0},
            {"freq": 1000.0, "q": 1.0, "gain": -2.0},
            {"freq": 500.0, "q": 1.0, "gain": 1.0},
            {"freq": 5000.0, "q": 0.7, "gain": 4.0},
        ]
    )

    errors, _warnings = _validate(config)

    assert (
        ["filters", "peq", "parameters", "bands", 2, "freq"],
        "Band frequencies must not decrease along the list",
    ) in errors


def test_filter_validation_rejects_npointpeq_band_above_nyquist():
    config = _npeq_config(
        [
            {"freq": 100.0, "q": 0.7, "gain": 3.0},
            {"freq": 30000.0, "q": 0.7, "gain": 4.0},
        ]
    )

    errors, _warnings = _validate(config)

    assert (
        ["filters", "peq", "parameters", "bands", 1, "freq"],
        "Frequency must be < samplerate/2",
    ) in errors


def _loudness_config(params, samplerate=48000):
    config = _base_config()
    config["devices"]["samplerate"] = samplerate
    config["filters"]["loud"] = {"type": "Loudness", "parameters": params}
    return config


def test_filter_validation_accepts_loudness_with_default_shelves():
    errors, _warnings = _validate(_loudness_config({"reference_level": -25.0}))

    assert errors == []


def test_filter_validation_accepts_loudness_with_custom_shelves():
    config = _loudness_config(
        {
            "reference_level": -25.0,
            "low_freq": 100.0,
            "high_freq": 4000.0,
            "low_q": 0.5,
            "high_q": 1.2,
        }
    )

    errors, _warnings = _validate(config)

    assert errors == []


def test_filter_validation_rejects_loudness_high_freq_below_low_freq():
    config = _loudness_config(
        {"reference_level": -25.0, "low_freq": 5000.0, "high_freq": 1000.0}
    )

    errors, _warnings = _validate(config)

    assert "High freq must be higher than low freq" in _error_messages(errors)


def test_filter_validation_compares_loudness_freqs_against_the_defaults():
    # Only low_freq is given, so high_freq is CamillaDSP's default of 3500
    config = _loudness_config({"reference_level": -25.0, "low_freq": 6000.0})

    errors, _warnings = _validate(config)

    assert "High freq must be higher than low freq" in _error_messages(errors)


def test_filter_validation_rejects_loudness_high_freq_above_nyquist():
    config = _loudness_config({"reference_level": -25.0, "high_freq": 30000.0})

    errors, _warnings = _validate(config)

    assert "High freq must be < samplerate/2" in _error_messages(errors)


def test_filter_validation_rejects_loudness_q_outside_the_allowed_range():
    for params in ({"high_q": 3.0}, {"low_q": 0.05}):
        config = _loudness_config({"reference_level": -25.0, **params})

        errors, _warnings = _validate(config)

        assert errors != []


def test_filter_validation_rejects_conv_with_no_values():
    # CamillaDSP rejects an empty coefficient list at config load. It used to
    # accept it and then panic on the first chunk.
    config = _base_config()
    config["filters"]["conv"] = {
        "type": "Conv",
        "parameters": {"type": "Values", "values": []},
    }

    errors, _warnings = _validate(config)

    assert (
        ["filters", "conv", "parameters", "values"],
        "[] should be non-empty",
    ) in errors


def test_filter_validation_accepts_conv_with_a_single_value():
    config = _base_config()
    config["filters"]["conv"] = {
        "type": "Conv",
        "parameters": {"type": "Values", "values": [1.0]},
    }

    errors, _warnings = _validate(config)

    assert errors == []


def _diffeq_config(params):
    config = _base_config()
    config["filters"]["deq"] = {"type": "DiffEq", "parameters": params}
    return config


UNSTABLE = "Unstable filter, the 'a' coefficients give poles on or outside the unit circle"


@pytest.mark.parametrize(
    "params,label",
    [
        ({"a": [1.0, -0.1462978543780541, 0.005350765548905586]}, "biquad lowpass"),
        ({}, "no coefficients, defaults to unity"),
        ({"a": [1.0]}, "single unity coefficient"),
        ({"a": [2.0, -0.5]}, "a0 not unity but stable"),
    ],
)
def test_filter_validation_accepts_stable_diffeq(params, label):
    errors, _warnings = _validate(_diffeq_config(params))

    assert errors == [], label


@pytest.mark.parametrize(
    "a,label",
    [
        ([1.0, -2.0, 1.0], "double pole exactly on the unit circle"),
        ([1.0, 0.0, -1.0], "poles at +1 and -1"),
        ([1.0, -3.0, 2.5], "poles well outside"),
    ],
)
def test_filter_validation_rejects_unstable_diffeq(a, label):
    errors, _warnings = _validate(_diffeq_config({"a": a}))

    assert UNSTABLE in _error_messages(errors), label


def test_filter_validation_rejects_diffeq_with_leading_zero():
    # np.roots would silently drop the order, and the DSP rejects it outright
    errors, _warnings = _validate(_diffeq_config({"a": [0.0, 1.0, 0.5]}))

    assert "The first 'a' coefficient must not be zero" in _error_messages(errors)
