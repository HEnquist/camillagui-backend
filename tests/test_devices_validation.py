from backend.dsp.validate_config import CamillaValidator


def _base_config():
    return {
        "devices": {
            "samplerate": 48000,
            "chunksize": 1024,
            "resampler": None,
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
        }
    }


def _validate(config):
    validator = CamillaValidator()
    validator.validate_config(config)
    issues = validator.get_errors()
    errors = [(path, message) for path, message, severity in issues if severity == "error"]
    warnings = [(path, message) for path, message, severity in issues if severity == "warning"]
    return errors, warnings, validator


def _error_messages(errors):
    return [message for _path, message in errors]


# === Target Level Rules ===

def test_devices_validation_enforces_target_level_limit_for_alsa_playback():
    config = _base_config()
    expected_limit = 8192
    config["devices"]["target_level"] = expected_limit + 1

    errors, _warnings, _validator = _validate(config)

    assert f"target_level cannot be larger than {expected_limit}" in _error_messages(errors)


def test_devices_validation_enforces_target_level_limit_for_non_alsa_playback():
    config = _base_config()
    expected_limit = 6144
    config["devices"]["playback"] = {
        "type": "File",
        "filename": "out.raw",
        "channels": 2,
        "format": "S16_LE",
        "wav_header": False,
    }
    config["devices"]["target_level"] = expected_limit + 1

    errors, _warnings, _validator = _validate(config)

    assert f"target_level cannot be larger than {expected_limit}" in _error_messages(errors)


# === ASIO Rules ===

def test_devices_validation_rejects_asio_duplex_with_different_devices():
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "Asio",
        "device": "asio-in",
        "channels": 2,
        "format": "S16_LE",
    }
    config["devices"]["playback"] = {
        "type": "Asio",
        "device": "asio-out",
        "channels": 2,
        "format": "S16_LE",
    }

    errors, _warnings, _validator = _validate(config)

    assert "ASIO must use the same device for capture and playback" in _error_messages(
        errors
    )


def test_devices_validation_rejects_asio_duplex_with_resampler():
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "Asio",
        "device": "asio0",
        "channels": 2,
        "format": "S16_LE",
    }
    config["devices"]["playback"] = {
        "type": "Asio",
        "device": "asio0",
        "channels": 2,
        "format": "S16_LE",
    }
    config["devices"]["resampler"] = {"type": "Synchronous"}

    errors, _warnings, _validator = _validate(config)

    assert "Full duplex ASIO does not allow resampling" in _error_messages(errors)


def test_devices_validation_accepts_asio_duplex_same_device_without_resampler():
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "Asio",
        "device": "asio0",
        "channels": 2,
        "format": "S16_LE",
    }
    config["devices"]["playback"] = {
        "type": "Asio",
        "device": "asio0",
        "channels": 2,
        "format": "S16_LE",
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


# === WASAPI Rules ===

def test_devices_validation_rejects_wasapi_capture_loopback_with_exclusive():
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "Wasapi",
        "channels": 2,
        "loopback": True,
        "exclusive": True,
        "format": "S16",
    }

    errors, _warnings, _validator = _validate(config)

    assert "exclusive mode cannot be combined with loopback capture" in _error_messages(
        errors
    )


def test_devices_validation_rejects_wasapi_capture_shared_non_f32_format():
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "Wasapi",
        "channels": 2,
        "exclusive": False,
        "format": "S16",
    }

    errors, _warnings, _validator = _validate(config)

    assert "in shared mode the format must be F32_LE or null" in _error_messages(errors)


def test_devices_validation_rejects_wasapi_playback_shared_non_f32_format():
    config = _base_config()
    config["devices"]["playback"] = {
        "type": "Wasapi",
        "channels": 2,
        "exclusive": False,
        "format": "S16",
    }

    errors, _warnings, _validator = _validate(config)

    assert "in shared mode the format must be F32_LE or null" in _error_messages(errors)


def test_devices_validation_accepts_capture_wasapi_type():
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "Wasapi",
        "channels": 2,
        "exclusive": True,
        "format": "S16",
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_accepts_playback_wasapi_type():
    config = _base_config()
    config["devices"]["playback"] = {
        "type": "Wasapi",
        "channels": 2,
        "exclusive": True,
        "format": "S16",
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


# === File-Based Device Rules ===

def test_devices_validation_rejects_invalid_wavfile_capture(monkeypatch):
    monkeypatch.setattr("backend.dsp.validate_config.os.path.exists", lambda _path: True)
    monkeypatch.setattr(
        "backend.dsp.validate_config.read_wav_header", lambda _path: None
    )
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "WavFile",
        "filename": "input.wav",
    }

    errors, _warnings, _validator = _validate(config)

    assert "Invalid or unsupported wav file 'input.wav'" in _error_messages(errors)


def test_devices_validation_warns_for_missing_wavfile_capture(monkeypatch):
    monkeypatch.setattr("backend.dsp.validate_config.os.path.exists", lambda _path: False)
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "WavFile",
        "filename": "input.wav",
    }

    errors, warnings, _validator = _validate(config)

    assert any(
        "unable to validate pipeline" in message.lower() for _path, message in errors
    )
    assert any(
        "Unable to find input file 'input.wav'" in message for _path, message in warnings
    )


def test_devices_validation_warns_for_missing_rawfile_capture(monkeypatch):
    monkeypatch.setattr("backend.dsp.validate_config.os.path.exists", lambda _path: False)
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "RawFile",
        "filename": "input.raw",
        "channels": 2,
        "format": "S16_LE",
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert any(
        "Unable to find input file 'input.raw'" in message for _path, message in warnings
    )


def test_devices_validation_sets_overrides_for_valid_wavfile_capture(monkeypatch):
    monkeypatch.setattr("backend.dsp.validate_config.os.path.exists", lambda _path: True)
    monkeypatch.setattr(
        "backend.dsp.validate_config.read_wav_header",
        lambda _path: {"samplerate": 44100, "channels": 1},
    )
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "WavFile",
        "filename": "input.wav",
    }
    config["devices"]["playback"]["channels"] = 1

    errors, warnings, validator = _validate(config)

    assert errors == []
    assert warnings == []
    assert validator.overrides == {"samplerate": 44100, "channels": 1}


def test_devices_validation_rejects_rj_format_with_wav_header_for_file_playback():
    config = _base_config()
    config["devices"]["playback"] = {
        "type": "File",
        "filename": "out.raw",
        "channels": 2,
        "format": "S24_4_RJ_LE",
        "wav_header": True,
    }

    errors, _warnings, _validator = _validate(config)

    assert "Format S24_4_RJ_LE cannot be used with wav_header" in _error_messages(errors)


def test_devices_validation_rejects_rj_format_with_wav_header_for_stdout_playback():
    config = _base_config()
    config["devices"]["playback"] = {
        "type": "Stdout",
        "channels": 2,
        "format": "S24_4_RJ_LE",
        "wav_header": True,
    }

    errors, _warnings, _validator = _validate(config)

    assert "Format S24_4_RJ_LE cannot be used with wav_header" in _error_messages(errors)


# === Capture Type Coverage ===

def test_devices_validation_accepts_capture_alsa_type():
    config = _base_config()

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_rejects_capture_pulse_type():
    # The Pulse backend was removed in CamillaDSP 5.0
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "Pulse",
        "device": "default",
        "channels": 2,
    }

    errors, _warnings, _validator = _validate(config)

    assert errors

def test_devices_validation_accepts_capture_pipewire_type():
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "PipeWire",
        "channels": 2,
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_accepts_capture_asio_type():
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "Asio",
        "device": "asio0",
        "channels": 2,
        "format": "S16_LE",
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_accepts_capture_coreaudio_type():
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "CoreAudio",
        "channels": 2,
        "format": "S16",
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_rejects_capture_jack_type():
    # The Jack backend was removed in CamillaDSP 5.0
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "Jack",
        "device": "default",
        "channels": 2,
    }

    errors, _warnings, _validator = _validate(config)

    assert errors

def test_devices_validation_accepts_capture_rawfile_type():
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "RawFile",
        "filename": "in.raw",
        "channels": 2,
        "format": "S16_LE",
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert all("Unable to find input file" in message for _path, message in warnings) or warnings == []


def test_devices_validation_accepts_capture_stdin_type():
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "Stdin",
        "channels": 2,
        "format": "S16_LE",
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_rejects_capture_bluez_type():
    # The Bluez backend was removed in CamillaDSP 5.0
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "Bluez",
        "dbus_path": "/org/bluez/hci0/dev_00_00_00_00_00_00",
        "channels": 2,
        "format": "S16_LE",
    }

    errors, _warnings, _validator = _validate(config)

    assert errors

def test_devices_validation_accepts_capture_signalgenerator_type():
    config = _base_config()
    config["devices"]["capture"] = {
        "type": "SignalGenerator",
        "channels": 2,
        "signal": {
            "type": "Sine",
            "freq": 1000.0,
            "level": -12.0,
        },
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


# === Playback Type Coverage ===

def test_devices_validation_accepts_playback_alsa_type():
    config = _base_config()

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_rejects_playback_pulse_type():
    # The Pulse backend was removed in CamillaDSP 5.0
    config = _base_config()
    config["devices"]["playback"] = {
        "type": "Pulse",
        "device": "default",
        "channels": 2,
    }

    errors, _warnings, _validator = _validate(config)

    assert errors

def test_devices_validation_accepts_playback_pipewire_type():
    config = _base_config()
    config["devices"]["playback"] = {
        "type": "PipeWire",
        "channels": 2,
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_accepts_playback_wasapi_type():
    config = _base_config()
    config["devices"]["playback"] = {
        "type": "Wasapi",
        "channels": 2,
        "exclusive": True,
        "format": "S16",
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_accepts_playback_asio_type():
    config = _base_config()
    config["devices"]["playback"] = {
        "type": "Asio",
        "device": "asio0",
        "channels": 2,
        "format": "S16_LE",
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_accepts_playback_coreaudio_type():
    config = _base_config()
    config["devices"]["playback"] = {
        "type": "CoreAudio",
        "channels": 2,
        "format": "S16",
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_rejects_playback_jack_type():
    # The Jack backend was removed in CamillaDSP 5.0
    config = _base_config()
    config["devices"]["playback"] = {
        "type": "Jack",
        "device": "default",
        "channels": 2,
    }

    errors, _warnings, _validator = _validate(config)

    assert errors

def test_devices_validation_accepts_playback_file_type():
    config = _base_config()
    config["devices"]["playback"] = {
        "type": "File",
        "filename": "out.raw",
        "channels": 2,
        "format": "S16_LE",
        "wav_header": False,
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_accepts_playback_stdout_type():
    config = _base_config()
    config["devices"]["playback"] = {
        "type": "Stdout",
        "channels": 2,
        "format": "S16_LE",
        "wav_header": False,
    }

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


# === Resampler Rules ===

def test_devices_validation_accepts_slip_resampler():
    config = _base_config()
    config["devices"]["resampler"] = {"type": "Slip"}

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_accepts_slip_resampler_with_matching_capture_samplerate():
    config = _base_config()
    config["devices"]["resampler"] = {"type": "Slip"}
    config["devices"]["capture_samplerate"] = config["devices"]["samplerate"]

    errors, warnings, _validator = _validate(config)

    assert errors == []
    assert warnings == []


def test_devices_validation_rejects_slip_resampler_with_differing_capture_samplerate():
    config = _base_config()
    config["devices"]["resampler"] = {"type": "Slip"}
    config["devices"]["capture_samplerate"] = 44100

    errors, _warnings, _validator = _validate(config)

    assert (
        "The Slip resampler requires matching samplerate and capture_samplerate"
        in _error_messages(errors)
    )


def test_devices_validation_accepts_other_resamplers_with_differing_capture_samplerate():
    for resampler in (
        {"type": "Synchronous"},
        {"type": "AsyncPoly", "interpolation": "Cubic"},
        {"type": "AsyncSinc", "profile": "Balanced"},
    ):
        config = _base_config()
        config["devices"]["resampler"] = resampler
        config["devices"]["capture_samplerate"] = 44100

        errors, warnings, _validator = _validate(config)

        assert errors == [], resampler
        assert warnings == [], resampler


def test_devices_validation_rejects_unknown_resampler_type():
    config = _base_config()
    config["devices"]["resampler"] = {"type": "Nonexistent"}

    errors, _warnings, _validator = _validate(config)

    assert errors != []
