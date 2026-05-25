"""
Tests for path manipulation and validation functions in filemanagement.py.
"""

import os
import pytest

from backend.filemanagement import (
    _path_is_safe,
    _to_bare_filename,
    coeff_path_to_absolute,
    make_audio_file_paths_bare,
    make_capture_file_path_absolute,
    make_config_filter_paths_absolute,
    make_config_filter_paths_relative,
    make_playback_file_path_absolute,
    validate_config_paths,
)

COEFF_DIR = "/srv/camilladsp/coeffs"
AUDIO_DIR = "/srv/camilladsp/audiofiles"
CONFIG_DIR = "/srv/camilladsp/configs"


# ---------------------------------------------------------------------------
# _path_is_safe
# ---------------------------------------------------------------------------

class TestPathIsSafe:
    def test_bare_filename_is_safe(self):
        assert _path_is_safe("myfile.wav", COEFF_DIR)

    def test_bare_filename_with_no_dir_is_safe(self):
        assert _path_is_safe("myfile.raw", None)

    def test_relative_path_with_separator_is_unsafe(self):
        assert not _path_is_safe("subdir/myfile.wav", COEFF_DIR)

    def test_relative_path_with_backslash_is_unsafe(self):
        assert not _path_is_safe("subdir\\myfile.wav", COEFF_DIR)

    def test_absolute_within_dir_is_safe(self):
        assert _path_is_safe(f"{COEFF_DIR}/myfile.wav", COEFF_DIR)

    def test_absolute_outside_dir_is_unsafe(self):
        assert not _path_is_safe("/etc/passwd", COEFF_DIR)

    def test_absolute_with_no_configured_dir_is_unsafe(self):
        assert not _path_is_safe("/etc/passwd", None)

    def test_absolute_traversal_outside_dir_is_unsafe(self):
        assert not _path_is_safe(f"{COEFF_DIR}/../../../etc/shadow", COEFF_DIR)


# ---------------------------------------------------------------------------
# _to_bare_filename
# ---------------------------------------------------------------------------

class TestToBareFilename:
    def test_absolute_within_dir_stripped(self):
        assert _to_bare_filename(f"{AUDIO_DIR}/sweep.wav", AUDIO_DIR) == "sweep.wav"

    def test_absolute_outside_dir_unchanged(self):
        path = "/other/location/sweep.wav"
        assert _to_bare_filename(path, AUDIO_DIR) == path

    def test_relative_path_returns_basename(self):
        assert _to_bare_filename("subdir/sweep.wav", AUDIO_DIR) == "sweep.wav"

    def test_bare_filename_unchanged(self):
        assert _to_bare_filename("sweep.wav", AUDIO_DIR) == "sweep.wav"


# ---------------------------------------------------------------------------
# make_capture_file_path_absolute
# ---------------------------------------------------------------------------

class TestMakeCaptureFilePathAbsolute:
    def _wavfile_config(self, filename):
        return {"devices": {"capture": {"type": "WavFile", "filename": filename}}}

    def _rawfile_config(self, filename):
        return {"devices": {"capture": {"type": "RawFile", "channels": 2, "format": "S32_LE", "filename": filename}}}

    def _alsa_config(self):
        return {"devices": {"capture": {"type": "Alsa", "channels": 2, "device": "hw:0"}}}

    def test_wavfile_bare_resolved(self):
        config = self._wavfile_config("sweep.wav")
        result = make_capture_file_path_absolute(config, AUDIO_DIR)
        assert result["devices"]["capture"]["filename"] == f"{AUDIO_DIR}/sweep.wav"

    def test_rawfile_bare_resolved(self):
        config = self._rawfile_config("capture.raw")
        result = make_capture_file_path_absolute(config, AUDIO_DIR)
        assert result["devices"]["capture"]["filename"] == f"{AUDIO_DIR}/capture.raw"

    def test_absolute_path_unchanged(self):
        config = self._wavfile_config(f"{AUDIO_DIR}/sweep.wav")
        result = make_capture_file_path_absolute(config, AUDIO_DIR)
        assert result["devices"]["capture"]["filename"] == f"{AUDIO_DIR}/sweep.wav"

    def test_non_file_capture_unchanged(self):
        config = self._alsa_config()
        result = make_capture_file_path_absolute(config, AUDIO_DIR)
        assert result == config

    def test_no_audiofiles_dir_unchanged(self):
        config = self._wavfile_config("sweep.wav")
        result = make_capture_file_path_absolute(config, None)
        assert result["devices"]["capture"]["filename"] == "sweep.wav"

    def test_original_not_mutated(self):
        config = self._wavfile_config("sweep.wav")
        make_capture_file_path_absolute(config, AUDIO_DIR)
        assert config["devices"]["capture"]["filename"] == "sweep.wav"


# ---------------------------------------------------------------------------
# make_playback_file_path_absolute
# ---------------------------------------------------------------------------

class TestMakePlaybackFilePathAbsolute:
    def _file_config(self, filename):
        return {"devices": {"playback": {"type": "File", "channels": 2, "format": "S32_LE", "filename": filename}}}

    def _stdout_config(self):
        return {"devices": {"playback": {"type": "Stdout", "channels": 2, "format": "S32_LE"}}}

    def test_bare_filename_resolved(self):
        config = self._file_config("output.wav")
        result = make_playback_file_path_absolute(config, AUDIO_DIR)
        assert result["devices"]["playback"]["filename"] == f"{AUDIO_DIR}/output.wav"

    def test_absolute_path_unchanged(self):
        config = self._file_config(f"{AUDIO_DIR}/output.wav")
        result = make_playback_file_path_absolute(config, AUDIO_DIR)
        assert result["devices"]["playback"]["filename"] == f"{AUDIO_DIR}/output.wav"

    def test_non_file_playback_unchanged(self):
        config = self._stdout_config()
        result = make_playback_file_path_absolute(config, AUDIO_DIR)
        assert result == config

    def test_no_audiofiles_dir_unchanged(self):
        config = self._file_config("output.wav")
        result = make_playback_file_path_absolute(config, None)
        assert result["devices"]["playback"]["filename"] == "output.wav"

    def test_original_not_mutated(self):
        config = self._file_config("output.wav")
        make_playback_file_path_absolute(config, AUDIO_DIR)
        assert config["devices"]["playback"]["filename"] == "output.wav"


# ---------------------------------------------------------------------------
# make_audio_file_paths_bare
# ---------------------------------------------------------------------------

class TestMakeAudioFilePathsBare:
    def test_wavfile_capture_stripped(self):
        config = {"devices": {"capture": {"type": "WavFile", "filename": f"{AUDIO_DIR}/sweep.wav"}}}
        result = make_audio_file_paths_bare(config, AUDIO_DIR)
        assert result["devices"]["capture"]["filename"] == "sweep.wav"

    def test_rawfile_capture_stripped(self):
        config = {"devices": {"capture": {"type": "RawFile", "channels": 2, "filename": f"{AUDIO_DIR}/capture.raw"}}}
        result = make_audio_file_paths_bare(config, AUDIO_DIR)
        assert result["devices"]["capture"]["filename"] == "capture.raw"

    def test_file_playback_stripped(self):
        config = {"devices": {"playback": {"type": "File", "channels": 2, "filename": f"{AUDIO_DIR}/output.wav"}}}
        result = make_audio_file_paths_bare(config, AUDIO_DIR)
        assert result["devices"]["playback"]["filename"] == "output.wav"

    def test_both_stripped_together(self):
        config = {
            "devices": {
                "capture": {"type": "WavFile", "filename": f"{AUDIO_DIR}/sweep.wav"},
                "playback": {"type": "File", "channels": 2, "filename": f"{AUDIO_DIR}/output.wav"},
            }
        }
        result = make_audio_file_paths_bare(config, AUDIO_DIR)
        assert result["devices"]["capture"]["filename"] == "sweep.wav"
        assert result["devices"]["playback"]["filename"] == "output.wav"

    def test_path_outside_dir_unchanged(self):
        config = {"devices": {"capture": {"type": "WavFile", "filename": "/other/sweep.wav"}}}
        result = make_audio_file_paths_bare(config, AUDIO_DIR)
        assert result["devices"]["capture"]["filename"] == "/other/sweep.wav"

    def test_no_audiofiles_dir_unchanged(self):
        config = {"devices": {"capture": {"type": "WavFile", "filename": f"{AUDIO_DIR}/sweep.wav"}}}
        result = make_audio_file_paths_bare(config, None)
        assert result["devices"]["capture"]["filename"] == f"{AUDIO_DIR}/sweep.wav"

    def test_original_not_mutated(self):
        config = {"devices": {"capture": {"type": "WavFile", "filename": f"{AUDIO_DIR}/sweep.wav"}}}
        make_audio_file_paths_bare(config, AUDIO_DIR)
        assert config["devices"]["capture"]["filename"] == f"{AUDIO_DIR}/sweep.wav"


# ---------------------------------------------------------------------------
# validate_config_paths
# ---------------------------------------------------------------------------

class TestValidateConfigPaths:
    def _conv_filter(self, filename, subtype="Wav"):
        return {"type": "Conv", "parameters": {"type": subtype, "filename": filename}}

    def test_bare_coeff_filename_is_valid(self):
        config = {"filters": {"f1": self._conv_filter("room.wav")}}
        assert validate_config_paths(config, COEFF_DIR, AUDIO_DIR) == []

    def test_absolute_coeff_within_dir_is_valid(self):
        config = {"filters": {"f1": self._conv_filter(f"{COEFF_DIR}/room.wav")}}
        assert validate_config_paths(config, COEFF_DIR, AUDIO_DIR) == []

    def test_absolute_coeff_outside_dir_is_invalid(self):
        config = {"filters": {"f1": self._conv_filter("/etc/passwd")}}
        offenders = validate_config_paths(config, COEFF_DIR, AUDIO_DIR)
        assert "/etc/passwd" in offenders

    def test_raw_conv_filter_also_checked(self):
        config = {"filters": {"f1": self._conv_filter("/etc/shadow", subtype="Raw")}}
        offenders = validate_config_paths(config, COEFF_DIR, AUDIO_DIR)
        assert "/etc/shadow" in offenders

    def test_non_conv_filter_not_checked(self):
        config = {"filters": {"f1": {"type": "Biquad", "parameters": {"type": "Peaking"}}}}
        assert validate_config_paths(config, COEFF_DIR, AUDIO_DIR) == []

    def test_bare_capture_filename_is_valid(self):
        config = {"devices": {"capture": {"type": "WavFile", "filename": "sweep.wav"}}}
        assert validate_config_paths(config, COEFF_DIR, AUDIO_DIR) == []

    def test_absolute_capture_outside_dir_is_invalid(self):
        config = {"devices": {"capture": {"type": "WavFile", "filename": "/etc/passwd"}}}
        offenders = validate_config_paths(config, COEFF_DIR, AUDIO_DIR)
        assert "/etc/passwd" in offenders

    def test_rawfile_capture_also_checked(self):
        config = {"devices": {"capture": {"type": "RawFile", "channels": 2, "filename": "/etc/shadow"}}}
        offenders = validate_config_paths(config, COEFF_DIR, AUDIO_DIR)
        assert "/etc/shadow" in offenders

    def test_bare_playback_filename_is_valid(self):
        config = {"devices": {"playback": {"type": "File", "channels": 2, "filename": "output.wav"}}}
        assert validate_config_paths(config, COEFF_DIR, AUDIO_DIR) == []

    def test_absolute_playback_outside_dir_is_invalid(self):
        config = {"devices": {"playback": {"type": "File", "channels": 2, "filename": "/etc/passwd"}}}
        offenders = validate_config_paths(config, COEFF_DIR, AUDIO_DIR)
        assert "/etc/passwd" in offenders

    def test_multiple_offenders_all_reported(self):
        config = {
            "filters": {"f1": self._conv_filter("/bad/coeff.wav")},
            "devices": {
                "capture": {"type": "WavFile", "filename": "/bad/capture.wav"},
                "playback": {"type": "File", "channels": 2, "filename": "/bad/output.wav"},
            },
        }
        offenders = validate_config_paths(config, COEFF_DIR, AUDIO_DIR)
        assert len(offenders) == 3

    def test_empty_config_is_valid(self):
        assert validate_config_paths({}, COEFF_DIR, AUDIO_DIR) == []

    def test_no_filters_key_is_valid(self):
        config = {"devices": {"capture": {"type": "Alsa", "channels": 2}}}
        assert validate_config_paths(config, COEFF_DIR, AUDIO_DIR) == []


# ---------------------------------------------------------------------------
# make_config_filter_paths_absolute / relative (existing functions)
# ---------------------------------------------------------------------------

class TestConfigFilterPathsAbsoluteRelative:
    def _config_with_conv(self, filename):
        return {
            "filters": {
                "MyConv": {"type": "Conv", "parameters": {"type": "Wav", "filename": filename}}
            }
        }

    # --- make_config_filter_paths_absolute ---

    def test_relative_coeff_made_absolute(self):
        config = self._config_with_conv("../coeffs/room.wav")
        result = make_config_filter_paths_absolute(config, CONFIG_DIR)
        expected = os.path.normpath(os.path.join(CONFIG_DIR, "../coeffs/room.wav"))
        assert result["filters"]["MyConv"]["parameters"]["filename"] == expected

    def test_absolute_coeff_unchanged_by_absolute(self):
        config = self._config_with_conv(f"{COEFF_DIR}/room.wav")
        result = make_config_filter_paths_absolute(config, CONFIG_DIR)
        assert result["filters"]["MyConv"]["parameters"]["filename"] == f"{COEFF_DIR}/room.wav"

    def test_bare_coeff_resolves_to_coeff_dir(self):
        config = self._config_with_conv("room.wav")
        result = make_config_filter_paths_absolute(config, CONFIG_DIR, COEFF_DIR)
        assert result["filters"]["MyConv"]["parameters"]["filename"] == f"{COEFF_DIR}/room.wav"

    def test_bare_coeff_without_coeff_dir_resolves_to_config_dir(self):
        config = self._config_with_conv("room.wav")
        result = make_config_filter_paths_absolute(config, CONFIG_DIR)
        assert result["filters"]["MyConv"]["parameters"]["filename"] == f"{CONFIG_DIR}/room.wav"

    def test_relative_coeff_with_coeff_dir_still_uses_config_dir(self):
        # Relative paths with separators always resolve against config_dir (backward compat)
        config = self._config_with_conv("../coeffs/room.wav")
        result = make_config_filter_paths_absolute(config, CONFIG_DIR, COEFF_DIR)
        expected = os.path.normpath(os.path.join(CONFIG_DIR, "../coeffs/room.wav"))
        assert result["filters"]["MyConv"]["parameters"]["filename"] == expected

    def test_no_filters_returns_unchanged(self):
        config = {"devices": {}}
        result = make_config_filter_paths_absolute(config, CONFIG_DIR)
        assert result == config

    # --- make_config_filter_paths_relative ---

    def test_absolute_coeff_in_coeff_dir_made_bare(self):
        config = self._config_with_conv(f"{COEFF_DIR}/room.wav")
        result = make_config_filter_paths_relative(config, CONFIG_DIR, COEFF_DIR)
        assert result["filters"]["MyConv"]["parameters"]["filename"] == "room.wav"

    def test_absolute_coeff_outside_coeff_dir_made_relative(self):
        config = self._config_with_conv(f"{COEFF_DIR}/room.wav")
        result = make_config_filter_paths_relative(config, CONFIG_DIR)
        expected = os.path.relpath(f"{COEFF_DIR}/room.wav", start=CONFIG_DIR)
        assert result["filters"]["MyConv"]["parameters"]["filename"] == expected

    def test_relative_coeff_unchanged_by_relative(self):
        config = self._config_with_conv("../coeffs/room.wav")
        result = make_config_filter_paths_relative(config, CONFIG_DIR)
        assert result["filters"]["MyConv"]["parameters"]["filename"] == "../coeffs/room.wav"

    def test_original_not_mutated(self):
        original = f"{COEFF_DIR}/room.wav"
        config = self._config_with_conv(original)
        make_config_filter_paths_relative(config, CONFIG_DIR)
        assert config["filters"]["MyConv"]["parameters"]["filename"] == original
