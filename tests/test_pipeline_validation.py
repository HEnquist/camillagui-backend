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
        "filters": {
            "lp": {
                "type": "Biquad",
                "parameters": {"type": "Lowpass", "freq": 1000.0, "q": 0.707},
            }
        },
        "mixers": {},
        "processors": {},
        "pipeline": [
            {
                "type": "Filter",
                "channels": [0, 1],
                "names": ["lp"],
            }
        ],
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

def test_pipeline_validation_accepts_valid_pipeline():
    config = _base_config()

    errors, warnings = _validate(config)

    assert errors == []
    assert warnings == []


# === Filter Step Rules ===

def test_pipeline_validation_rejects_missing_filter_reference():
    config = _base_config()
    config["pipeline"][0]["names"] = ["missing_filter"]

    errors, _warnings = _validate(config)

    assert "Use of missing filter 'missing_filter'" in _error_messages(errors)


def test_pipeline_validation_rejects_non_existing_channel_reference():
    config = _base_config()
    config["pipeline"][0]["channels"] = [2]

    errors, _warnings = _validate(config)

    assert "Use of non existing channel 2" in _error_messages(errors)


# === Mixer Step Rules ===

def test_pipeline_validation_rejects_missing_mixer_reference():
    config = _base_config()
    config["pipeline"] = [{"type": "Mixer", "name": "missing_mixer"}]

    errors, _warnings = _validate(config)

    assert "Use of missing mixer 'missing_mixer'" in _error_messages(errors)


def test_pipeline_validation_rejects_mixer_wrong_input_channel_count():
    config = _base_config()
    config["mixers"]["mono"] = {
        "channels": {"in": 1, "out": 2},
        "mapping": [
            {"dest": 0, "sources": [{"channel": 0}]},
            {"dest": 1, "sources": [{"channel": 0}]},
        ],
    }
    config["pipeline"] = [{"type": "Mixer", "name": "mono"}]

    errors, _warnings = _validate(config)

    assert (
        "Mixer 'mono' has wrong number of input channels. Expected 2, found 1"
        in _error_messages(errors)
    )


# === Processor Step Rules ===

def test_pipeline_validation_rejects_missing_processor_reference():
    config = _base_config()
    config["pipeline"] = [{"type": "Processor", "name": "missing_processor"}]

    errors, _warnings = _validate(config)

    assert "Use of missing processor 'missing_processor'" in _error_messages(errors)


def test_pipeline_validation_rejects_processor_wrong_channel_count():
    config = _base_config()
    config["processors"]["compress"] = {
        "type": "Compressor",
        "parameters": {
            "channels": 1,
            "attack": 0.01,
            "attack_unit": "s",
            "release": 0.1,
            "release_unit": "s",
            "threshold": -10.0,
            "factor": 2.0,
        },
    }
    config["pipeline"] = [{"type": "Processor", "name": "compress"}]

    errors, _warnings = _validate(config)

    assert (
        "Processor 'compress' has wrong number of channels. Expected 2, found 1"
        in _error_messages(errors)
    )


# === Pipeline Output Rules ===

def test_pipeline_validation_rejects_output_channel_mismatch():
    config = _base_config()
    config["mixers"]["to_mono"] = {
        "channels": {"in": 2, "out": 1},
        "mapping": [
            {
                "dest": 0,
                "sources": [{"channel": 0}, {"channel": 1}],
            }
        ],
    }
    config["pipeline"] = [{"type": "Mixer", "name": "to_mono"}]

    errors, _warnings = _validate(config)

    assert "Pipeline outputs 1 channels, playback device has 2" in _error_messages(errors)