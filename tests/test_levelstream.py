import math

import pytest

from backend.levelstream import LevelEventStream


def test_smoothing_alpha_respects_time_constant():
    stream = LevelEventStream("127.0.0.1", 1234, {}, smoothing_time_constant_ms=100)
    alpha = stream._smoothing_alpha(0.1, 0.1)
    assert alpha == pytest.approx(1.0 - math.exp(-1.0), abs=1e-6)


def test_smoothing_can_be_disabled_with_zero_time_constant():
    stream = LevelEventStream("127.0.0.1", 1234, {}, smoothing_time_constant_ms=0)
    first = stream._apply_smoothing("capture", [0.0], [0.0], 1.0)
    second = stream._apply_smoothing("capture", [10.0], [20.0], 1.0)
    assert first["rms"] == [0.0]
    assert second["rms"] == [10.0]
    assert second["peak"] == [20.0]


def test_apply_smoothing_uses_exponential_moving_average():
    stream = LevelEventStream("127.0.0.1", 1234, {}, smoothing_time_constant_ms=100)
    stream._apply_smoothing("playback", [0.0], [0.0], 10.0)

    smoothed = stream._apply_smoothing("playback", [10.0], [20.0], 10.1)
    expected_alpha = 1.0 - math.exp(-0.1 / (0.35 * 0.1))

    assert smoothed["rms"][0] == pytest.approx(expected_alpha * 10.0, abs=1e-6)
    assert smoothed["peak"][0] == pytest.approx(expected_alpha * 20.0, abs=1e-6)


def test_asymmetric_smoothing_rises_faster_than_it_falls():
    stream = LevelEventStream("127.0.0.1", 1234, {}, smoothing_time_constant_ms=100)

    stream._apply_smoothing("capture", [0.0], [0.0], 1.0)
    rising = stream._apply_smoothing("capture", [10.0], [10.0], 1.1)
    # Reset side to compare using the same dt but opposite direction.
    stream._apply_smoothing("playback", [10.0], [10.0], 2.0)
    falling = stream._apply_smoothing("playback", [0.0], [0.0], 2.1)

    rise_step = rising["rms"][0] - 0.0
    fall_step = 10.0 - falling["rms"][0]
    assert rise_step > fall_step


def test_level_rate_limit_allows_first_publish_then_throttles():
    stream = LevelEventStream("127.0.0.1", 1234, {}, max_update_hz=30)

    assert stream._should_publish_level_event("capture", 1.0) is True
    assert stream._should_publish_level_event("capture", 1.02) is False
    assert stream._should_publish_level_event("capture", 1.04) is True


def test_level_rate_limit_is_independent_per_side():
    stream = LevelEventStream("127.0.0.1", 1234, {}, max_update_hz=30)

    assert stream._should_publish_level_event("playback", 1.0) is True
    # Capture should still be allowed immediately because it has its own limiter.
    assert stream._should_publish_level_event("capture", 1.001) is True
    assert stream._should_publish_level_event("playback", 1.01) is False
    assert stream._should_publish_level_event("capture", 1.011) is False


def test_level_rate_limit_can_be_disabled():
    stream = LevelEventStream("127.0.0.1", 1234, {}, max_update_hz=0)

    assert stream._should_publish_level_event("capture", 1.0) is True
    assert stream._should_publish_level_event("capture", 1.001) is True
