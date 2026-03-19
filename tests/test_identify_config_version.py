import pytest
from camilladsp_plot.validate_config import CamillaValidator

from backend.legacy_config_import import (
    identify_version,
    _look_for_v1_devices,
    _look_for_v1_dither,
    _look_for_v1_loudness,
    _look_for_v1_resampler,
    _look_for_v1_volume,
    _look_for_v2_devices,
    _look_for_v2_pipeline,
    _look_for_v3_mixer,
    _look_for_v3_sample_formats,
)


def config_base():
    # Basic config, valid for CamillaDSP v4.0
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
            "resampler": {"type": "AsyncSinc", "profile": "Fast"},
            "capture_samplerate": 44100,
            "stop_on_rate_change": False,
            "rate_measure_interval": 1.0,
            "capture": {"type": "Stdin", "channels": 2, "format": "S16_LE"},
            "playback": {"type": "Stdout", "channels": 2, "format": "S32_LE"},
        },
        "filters": {
            "vol": {
                "type": "Volume",
                "parameters": {"ramp_time": 200, "fader": "Aux1"},
            },
            "hp_80": {
                "type": "Biquad",
                "parameters": {"type": "Highpass", "freq": 80, "q": 0.5},
            },
            "loudness": {
                "type": "Loudness",
                "parameters": {
                    "fader": "Main",
                    "reference_level": -25.0,
                    "high_boost": 7.0,
                    "low_boost": 7.0,
                    "attenuate_mid": False,
                },
            },
            "dither": {
                "type": "Dither",
                "parameters": {"type": "Highpass", "bits": 16},
            },
        },
        "mixers": {
            "2x2": {
                "channels": {"in": 2, "out": 2},
                "mapping": [
                    {"dest": 0, "sources": [{"channel": 0, "gain": 0}]},
                    {"dest": 1, "sources": [{"channel": 1, "gain": 0}]},
                ],
            }
        },
        "pipeline": [
            {"type": "Filter", "channels": [0], "names": ["vol", "hp_80"]},
            {"type": "Filter", "channels": [1], "names": ["vol"]},
            {"type": "Mixer", "name": "2x2"},
        ],
    }
    return config


@pytest.fixture
def config_v1():
    # Config for camilladsp v1.0.x
    config = config_base()
    # resampler
    config["devices"]["resampler_type"] = "BalancedAsync"
    config["devices"]["enable_resampling"] = True
    config["devices"].pop("resampler")

    # devices
    config["devices"]["capture"]["format"] = "S16LE"
    config["devices"]["playback"] = {
        "type": "CoreAudio",
        "channels": 2,
        "device": "Built-in Output",
        "format": "S32LE",
        "exclusive": False,
        "change_format": False,
    }

    # volume filter
    config["filters"]["vol"]["parameters"].pop("fader")

    # loudness filter
    config["filters"]["loudness"]["parameters"].pop("attenuate_mid")
    config["filters"]["loudness"]["parameters"]["ramp_time"] = 200.0

    # dither filter
    config["filters"]["dither"]["parameters"]["type"] = "Simple"

    # filter pipeline steps
    for step in config["pipeline"]:
        if step["type"] == "Filter":
            step["channel"] = step["channels"][0]
            step.pop("channels")

    yield config


@pytest.fixture
def config_v2():
    # Config for camilladsp v2.0.x
    config = config_base()

    # devices
    config["devices"]["capture"] = {
        "type": "File",
        "channels": 2,
        "filename": "/path/to/inputfile.raw",
        "format": "S16_LE",
        "extra_samples": 123,
        "skip_bytes": 0,
        "read_bytes": 0,
    }

    # filter pipeline steps
    for step in config["pipeline"]:
        if step["type"] == "Filter":
            step["channel"] = step["channels"][0]
            step.pop("channels")

    yield config


@pytest.fixture
def config_v3():
    # Config for camilladsp v3.0.x
    config = config_base()

    # sample formats
    config["devices"]["capture"]["format"] = "S16LE"
    config["devices"]["playback"]["format"] = "S32LE"

    # mixer
    config["mixers"]["2x2"]["mapping"].append(
        {"dest": 0, "sources": [{"channel": 1, "gain": 0}]}
    )

    yield config


@pytest.fixture
def config_v4():
    # Config for camilladsp v4.0.x
    config = config_base()
    yield config


def test_identify_v1(config_v1):
    assert _look_for_v1_resampler(config_v1) is True
    assert _look_for_v1_volume(config_v1) is True
    assert _look_for_v1_dither(config_v1) is True
    assert _look_for_v1_loudness(config_v1) is True
    assert _look_for_v1_devices(config_v1) is True
    assert identify_version(config_v1) == 1


def test_identify_v2(config_v2):
    assert _look_for_v2_devices(config_v2) is True
    assert _look_for_v2_pipeline(config_v2) is True
    assert identify_version(config_v2) == 2


def test_identify_v3(config_v3):
    assert _look_for_v3_sample_formats(config_v3) is True
    assert _look_for_v3_mixer(config_v3) is True
    assert identify_version(config_v3) == 3


def test_identify_v4(config_v4):
    assert identify_version(config_v4) == 4
