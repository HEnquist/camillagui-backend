from backend.filters import filter_plot_options


def test_filter_plot_options_with_samplerate():
    result = filter_plot_options(
        ["filter_44100_2", "filter_44100_8", "filter_48000_2", "filter_48000_8"],
        "filter_$samplerate$_2",
    )
    expected = [
        {"name": "filter_44100_2", "samplerate": 44100},
        {"name": "filter_48000_2", "samplerate": 48000},
    ]
    assert result == expected


def test_filter_plot_options_with_channels():
    result = filter_plot_options(
        ["filter_44100_2", "filter_44100_8", "filter_48000_2", "filter_48000_8"],
        "filter_44100_$channels$",
    )
    expected = [
        {"name": "filter_44100_2", "channels": 2},
        {"name": "filter_44100_8", "channels": 8},
    ]
    assert result == expected


def test_filter_plot_options_with_samplerate_and_channels():
    result1 = filter_plot_options(
        ["filter_44100_2", "filter_44100_8", "filter_48000_2", "filter_48000_8"],
        "filter_$samplerate$_$channels$",
    )
    expected1 = [
        {"name": "filter_44100_2", "samplerate": 44100, "channels": 2},
        {"name": "filter_44100_8", "samplerate": 44100, "channels": 8},
        {"name": "filter_48000_2", "samplerate": 48000, "channels": 2},
        {"name": "filter_48000_8", "samplerate": 48000, "channels": 8},
    ]
    assert result1 == expected1

    result2 = filter_plot_options(
        ["filter_2_44100", "filter_8_44100", "filter_2_48000", "filter_8_48000"],
        "filter_$channels$_$samplerate$",
    )
    expected2 = [
        {"name": "filter_2_44100", "samplerate": 44100, "channels": 2},
        {"name": "filter_8_44100", "samplerate": 44100, "channels": 8},
        {"name": "filter_2_48000", "samplerate": 48000, "channels": 2},
        {"name": "filter_8_48000", "samplerate": 48000, "channels": 8},
    ]
    assert result2 == expected2


def test_filter_plot_options_without_samplerate_and_channels():
    result = filter_plot_options(
        ["filter_44100_2", "filter_44100_8", "filter_48000_2", "filter_48000_8"],
        "filter_44100_2",
    )
    expected = [{"name": "filter_44100_2"}]
    assert result == expected


def test_filter_plot_options_handles_filenames_with_brackets():
    expected = filter_plot_options(
        [
            "filter_((44100)_(2))",
            "filter_((44100)_(8))",
            "filter_((48000)_(2))",
            "filter_((48000)_(8))",
        ],
        "filter_(($samplerate$)_($channels$))",
    )
    result = [
        {"name": "filter_((44100)_(2))", "samplerate": 44100, "channels": 2},
        {"name": "filter_((44100)_(8))", "samplerate": 44100, "channels": 8},
        {"name": "filter_((48000)_(2))", "samplerate": 48000, "channels": 2},
        {"name": "filter_((48000)_(8))", "samplerate": 48000, "channels": 8},
    ]
    assert result == expected
