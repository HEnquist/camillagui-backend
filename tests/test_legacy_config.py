import pytest
from backend.dsp.validate_config import CamillaValidator

from backend.legacy_config_import import (
    _modify_devices,
    _modify_dither,
    _modify_loundness_filters,
    _modify_mixers,
    _modify_pipeline_filter_steps,
    _remove_volume_filters,
    migrate_legacy_config,
)


@pytest.fixture
def basic_config():
    # Config for camilladsp v1.0.x
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
    assert capture["format"] == "S32"
    assert playback["format"] == None


def test_disabled_resampling(basic_config):
    _modify_devices(basic_config)
    assert "enable_resampling" not in basic_config["devices"]
    assert basic_config["devices"]["resampler"] == None


def test_pipeline_filter_step_channels(basic_config):
    _modify_pipeline_filter_steps(basic_config)
    for step in basic_config["pipeline"]:
        assert "channel" not in step
        assert isinstance(step["channels"], list)


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


def test_rew_export(basic_config):
    # REW exports a single pipeline step rather than a list.
    # Check that this is handled ok.
    basic_config["pipeline"] = basic_config["pipeline"][0]
    migrate_legacy_config(basic_config)
    assert len(basic_config["pipeline"]) == 1


def test_merge_mixer_mappings(basic_config):
    config = basic_config
    # Insert a mixer with multiple mappings and sources per channel
    config["mixers"]["test"] = {
        "channels": {"in": 4, "out": 2},
        "mapping": [
            {"dest": 0, "sources": [{"channel": 0, "gain": -1}]},
            # this should get merged into the previous
            {"dest": 0, "sources": [{"channel": 1, "gain": -2}]},
            {"dest": 1, "sources": [{"channel": 2, "gain": -3}]},
            # this should get dropped
            {"dest": 1, "sources": [{"channel": 2, "gain": -4}]},
        ],
    }

    _modify_mixers(config)
    assert (
        config["mixers"]["test"]
        == config["mixers"]["test"]
        == {
            "channels": {"in": 4, "out": 2},
            "mapping": [
                {
                    "dest": 0,
                    "sources": [{"channel": 0, "gain": -1}, {"channel": 1, "gain": -2}],
                },
                {"dest": 1, "sources": [{"channel": 2, "gain": -3}]},
            ],
        }
    )


# === v4 -> v5 ===


@pytest.fixture
def v4_config():
    # Config for camilladsp v4.x, exercising every v5 rename at once
    return {
        "devices": {
            "samplerate": 48000,
            "chunksize": 1024,
            "adjust_period": 10,
            "silence_timeout": 3.0,
            "rate_measure_interval": 1.0,
            "volume_ramp_time": 400.0,
            "capture": {"type": "Stdin", "channels": 2, "format": "S16_LE"},
            "playback": {"type": "Stdout", "channels": 2, "format": "S32_LE"},
        },
        "filters": {
            "dly": {"type": "Delay", "parameters": {"delay": 3.0, "unit": "mm"}},
            "dly_default": {"type": "Delay", "parameters": {"delay": 3.0}},
            "vol": {
                "type": "Volume",
                "parameters": {"ramp_time": 200.0, "fader": "Aux1"},
            },
            "lim": {"type": "Limiter", "parameters": {"clip_limit": -3.0}},
        },
        "processors": {
            "comp": {
                "type": "Compressor",
                "parameters": {
                    "channels": 2,
                    "attack": 0.025,
                    "release": 1.0,
                    "threshold": -25.0,
                    "factor": 5.0,
                },
            },
            "gate": {
                "type": "NoiseGate",
                "parameters": {
                    "channels": 2,
                    "attack": 0.025,
                    "release": 1.0,
                    "threshold": -60.0,
                    "attenuation": 20.0,
                },
            },
            "race": {
                "type": "RACE",
                "parameters": {
                    "channels": 2,
                    "channel_a": 0,
                    "channel_b": 1,
                    "delay": 0.1,
                    "attenuation": 10.0,
                },
            },
        },
        "pipeline": [
            {"type": "Filter", "channels": [0], "names": ["dly", "vol", "lim"]},
            {"type": "Processor", "name": "comp"},
        ],
    }


def test_v5_migrates_device_time_units(v4_config):
    migrate_legacy_config(v4_config)
    devices = v4_config["devices"]
    assert devices["adjust_interval_s"] == 10
    assert devices["silence_timeout_s"] == 3.0
    assert devices["rate_measure_interval_s"] == 1.0
    assert devices["volume_ramp_time_ms"] == 400.0
    for old_name in (
        "adjust_period",
        "silence_timeout",
        "rate_measure_interval",
        "volume_ramp_time",
    ):
        assert old_name not in devices


def test_v5_migrates_filter_time_units(v4_config):
    migrate_legacy_config(v4_config)
    filters = v4_config["filters"]
    # an explicit unit is carried over unchanged
    assert filters["dly"]["parameters"]["delay_unit"] == "mm"
    assert "unit" not in filters["dly"]["parameters"]
    # a missing one becomes the CamillaDSP 4 default, so the delay is unchanged
    assert filters["dly_default"]["parameters"]["delay_unit"] == "ms"
    assert filters["vol"]["parameters"]["ramp_time_ms"] == 200.0
    assert "ramp_time" not in filters["vol"]["parameters"]


def test_v5_renames_limiter_to_clipper(v4_config):
    migrate_legacy_config(v4_config)
    assert v4_config["filters"]["lim"]["type"] == "Clipper"
    # the parameters are untouched by the rename
    assert v4_config["filters"]["lim"]["parameters"] == {"clip_limit": -3.0}


def test_v5_migrates_processor_time_units(v4_config):
    migrate_legacy_config(v4_config)
    processors = v4_config["processors"]
    # v4 attack and release were in seconds, and the values must not change
    for name in ("comp", "gate"):
        params = processors[name]["parameters"]
        assert params["attack_unit"] == "s"
        assert params["release_unit"] == "s"
        assert params["attack"] == 0.025
        assert params["release"] == 1.0
    # RACE defaulted to milliseconds
    assert processors["race"]["parameters"]["delay_unit"] == "ms"


def test_v5_migrated_config_validates(v4_config):
    validator = CamillaValidator()
    validator.validate_config(v4_config)
    assert len(validator.get_errors()) > 0

    migrate_legacy_config(v4_config)
    validator.validate_config(v4_config)
    assert validator.get_errors() == []


def test_v5_migration_keeps_removed_backend_for_the_validator_to_report(v4_config):
    # A dropped backend is left alone on purpose: the rest of the config is
    # migrated, and the user is told about the one thing they have to change.
    v4_config["devices"]["capture"] = {
        "type": "Pulse",
        "device": "default",
        "channels": 2,
    }
    migrate_legacy_config(v4_config)

    assert v4_config["devices"]["capture"]["type"] == "Pulse"
    assert v4_config["devices"]["adjust_interval_s"] == 10

    validator = CamillaValidator()
    validator.validate_config(v4_config)
    errors = validator.get_errors()
    assert errors
    assert all(error[0][:2] == ["devices", "capture"] for error in errors)
