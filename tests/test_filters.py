from backend.filters import filter_plot_options, pipeline_step_plot_options


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


def test_pipeline_step_plot_options_for_only_one_samplerate_and_channel_option():
    config = {
        "devices": {"samplerate": 44100, "capture": {"channels": 2}},
        "filters": {
            "Filter1": {
                "type": "Conv",
                "parameters": {"type": "Raw", "filename": "../coeffs/filter-44100-2"},
            },
            "Filter2": {
                "type": "Conv",
                "parameters": {
                    "type": "Wav",
                    "filename": "../coeffs/filter-$samplerate$-$channels$",
                },
            },
            "irrelevantFilter": {"type": "something else", "parameters": {}},
        },
        "pipeline": [
            {
                "channel": 0,
                "type": "Filter",
                "names": ["Filter1", "Filter2", "irrelevantFilter"],
            }
        ],
    }
    filter_file_names = [
        "filter-44100-2",
        "filter-44100-8",
        "filter-48000-2",
        "filter-48000-8",
    ]
    result = pipeline_step_plot_options(filter_file_names, config, 0)
    expected = [{"name": "44100 Hz - 2 Channels", "samplerate": 44100, "channels": 2}]
    assert result == expected


def test_pipeline_step_plot_options_for_many_samplerate_and_channel_options():
    config = {
        "devices": {"samplerate": 44100, "capture": {"channels": 2}},
        "filters": {
            "Filter1": {
                "type": "Conv",
                "parameters": {
                    "type": "Raw",
                    "filename": "../coeffs/filter-$samplerate$-$channels$",
                },
            },
            "Filter2": {
                "type": "Conv",
                "parameters": {
                    "type": "Raw",
                    "filename": "../coeffs/filter-$samplerate$-$channels$",
                },
            },
        },
        "pipeline": [{"channel": 0, "type": "Filter", "names": ["Filter1", "Filter2"]}],
    }
    filter_file_names = [
        "filter-44100-2",
        "filter-44100-8",
        "filter-48000-2",
        "filter-48000-8",
    ]
    result = pipeline_step_plot_options(filter_file_names, config, 0)
    expected = [
        {"name": "44100 Hz - 2 Channels", "samplerate": 44100, "channels": 2},
        {"name": "44100 Hz - 8 Channels", "samplerate": 44100, "channels": 8},
        {"name": "48000 Hz - 2 Channels", "samplerate": 48000, "channels": 2},
        {"name": "48000 Hz - 8 Channels", "samplerate": 48000, "channels": 8},
    ]
    assert result == expected
