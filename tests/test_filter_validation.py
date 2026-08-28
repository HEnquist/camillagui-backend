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
