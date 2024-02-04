import pytest

from backend.legacy_config_import import _modify_devices

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
            "capture": {
                "type": "Stdin",
                "channels": 2,
                "format": "S16LE"
                },
            "playback": {
                "type": "Stdout",
                "channels": 2,
                "format": "S32LE"
            }
        },
        "filters": {},
        "mixers": {},
        "pipeline": {}
    }
    yield config
    

def test_coreaudio_device(basic_config):
    config = basic_config
    config["devices"]["capture"] = {
        "type": "CoreAudio",
        "channels": 2,
        "device": "Soundflower (2ch)",
        "format": "S32LE",
        "change_format": True
    }
    config["devices"]["playback"] = {
        "type": "CoreAudio",
        "channels": 2,
        "device": "Built-in Output",
        "format": "S32LE",
        "exclusive": False,
        "change_format": False
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

