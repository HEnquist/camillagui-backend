import pytest

from backend.legacy_config_import import (
    _modify_devices,
    _remove_volume_filters,
    _modify_loundness_filters,
    _modify_dither,
    migrate_legacy_config,
)
from camilladsp_plot.validate_config import CamillaValidator


@pytest.fixture
def basic_config():
    config = {
        "devices": {
            "samplerate": 96000,
            "chunksize": 2048,
            "queuelimit": 4,
            "silence_threshold": -60,
            "silence_timeout": 3.0,
            "target_level": 500,
            "adjust_period": 10,
            "enable_rate_adjust": True,
            "resampler_type": "BalancedAsync",
            "enable_resampling": False,
            "capture_samplerate": 44100,
            "stop_on_rate_change": False,
            "rate_measure_interval": 1.0,
            "capture": {"type": "Stdin", "channels": 2, "format": "S16LE"},
            "playback": {"type": "Stdout", "channels": 2, "format": "S32LE"},
        },
        "filters": {
            "vol": {"type": "Volume", "parameters": {"ramp_time": 200}},
            "hp_80": {
                "type": "Biquad",
                "parameters": {"type": "Highpass", "freq": 80, "q": 0.5},
            },
            "loudness": {
                "type": "Loudness",
                "parameters": {
                    "ramp_time": 200.0,
                    "reference_level": -25.0,
                    "high_boost": 7.0,
                    "low_boost": 7.0,
                },
            },
            "dither": {"type": "Dither", "parameters": {"type": "Simple", "bits": 16}},
        },
        "mixers": {},
        "pipeline": [
            {"type": "Filter", "channel": 0, "names": ["vol", "hp_80"]},
            {"type": "Filter", "channel": 1, "names": ["vol"]},
        ],
    }
    yield config


def test_coreaudio_device(basic_config):
    config = basic_config
    # Insert CoreAudio capture and playback devices
    config["devices"]["capture"] = {
        "type": "CoreAudio",
        "channels": 2,
        "device": "Soundflower (2ch)",
        "format": "S32LE",
        "change_format": True,
    }
    config["devices"]["playback"] = {
        "type": "CoreAudio",
        "channels": 2,
        "device": "Built-in Output",
        "format": "S32LE",
        "exclusive": False,
        "change_format": False,
    }
    _modify_devices(config)
    capture = config["devices"]["capture"]
    playback = config["devices"]["playback"]
    assert "change_format" not in capture
    assert "change_format" not in playback
    assert capture["format"] == "S32LE"
    assert playback["format"] == None


def test_disabled_resampling(basic_config):
    _modify_devices(basic_config)
    assert "enable_resampling" not in basic_config["devices"]
    assert basic_config["devices"]["resampler"] == None


def test_removed_volume_filters(basic_config):
    _remove_volume_filters(basic_config)
    assert "vol" not in basic_config["filters"]
    assert len(basic_config["pipeline"]) == 1
    assert basic_config["pipeline"][0]["names"] == ["hp_80"]


def test_update_loudness_filters(basic_config):
    _modify_loundness_filters(basic_config)
    params = basic_config["filters"]["loudness"]["parameters"]
    assert "ramp_time" not in params
    assert params["fader"] == "Main"
    assert params["attenuate_mid"] == False


def test_modify_dither(basic_config):
    _modify_dither(basic_config)
    params = basic_config["filters"]["dither"]["parameters"]
    assert params["type"] == "Highpass"


def test_free_resampler(basic_config):
    basic_config["devices"]["resampler_type"] = {
        "FreeAsync": {
            "f_cutoff": 0.9,
            "sinc_len": 128,
            "window": "Hann2",
            "oversampling_ratio": 64,
            "interpolation": "Cubic",
        }
    }
    basic_config["devices"]["enable_resampling"] = True
    _modify_devices(basic_config)
    assert "enable_resampling" not in basic_config["devices"]
    assert basic_config["devices"]["resampler"] == {
        "type": "AsyncSinc",
        "f_cutoff": 0.9,
        "sinc_len": 128,
        "window": "Hann2",
        "oversampling_factor": 64,
        "interpolation": "Cubic",
    }


def test_schema_validation(basic_config):
    # verify that the test config is not yet valid
    validator = CamillaValidator()
    validator.validate_config(basic_config)
    errors = validator.get_errors()
    assert len(errors) > 0

    # migrate and validate
    migrate_legacy_config(basic_config)
    validator.validate_config(basic_config)
    errors = validator.get_errors()
    assert len(errors) == 0

def test_filters_only(basic_config):
    # make a config containing only filters,
    # to check that partial configs can be translated
    filters_only = {"filters": basic_config["filters"]}
    migrate_legacy_config(filters_only)
    assert len(filters_only["filters"]) == 3
