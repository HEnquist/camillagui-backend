from textwrap import dedent
from backend.convolver_config_import import (
    ConvolverConfig,
    filename_of_path,
    channels_factors_and_inversions_as_list,
)


def clean_multi_line_string(multiline_text: str):
    """
    :param multiline_text:
    :return: the text without the first blank line and indentation
    """
    return dedent(multiline_text.removeprefix("\n"))


def test_filename_of_path():
    assert "File.wav" == filename_of_path("File.wav")
    assert "File.wav" == filename_of_path("/some/path/File.wav")
    assert "File.wav" == filename_of_path("C:\\some\\path\\File.wav")


def test_channels_factors_and_inversions_as_list():
    assert channels_factors_and_inversions_as_list("0.0 1.1 -9.9") == [
        (0, 1.0, False),
        (1, 0.1, False),
        (9, 0.9, True),
    ]
    # Straight inversion
    # Note, the Convolver documentation says to use
    # -0.99999 and not -0.0 for this.
    assert channels_factors_and_inversions_as_list("-0.0 -0.99999") == [
        (0, 1.0, True),
        (0, 0.99999, True),
    ]


def test_samplerate_is_imported():
    convolver_config = clean_multi_line_string(
        """
        96000 1 2 0
        0
        0
    """
    )
    conf = ConvolverConfig(convolver_config).to_object()
    assert conf["devices"] == {"samplerate": 96000}


def test_delays_and_mixers_are_imported():
    convolver_config = clean_multi_line_string(
        """
        96000 2 3 0
        3
        0 4
    """
    )
    expected_filters = {
        "Delay3": {
            "type": "Delay",
            "parameters": {"delay": 3, "unit": "ms", "subsample": False},
        },
        "Delay4": {
            "type": "Delay",
            "parameters": {"delay": 4, "unit": "ms", "subsample": False},
        },
    }
    expected_pipeline = [
        {
            "type": "Filter",
            "channel": 0,
            "names": ["Delay3"],
            "bypassed": None,
            "description": None,
        },
        {"type": "Mixer", "name": "Mixer in", "description": None},
        {"type": "Mixer", "name": "Mixer out", "description": None},
        {
            "type": "Filter",
            "channel": 1,
            "names": ["Delay4"],
            "bypassed": None,
            "description": None,
        },
    ]

    conf = ConvolverConfig(convolver_config).to_object()

    assert conf["filters"] == expected_filters
    assert conf["mixers"]["Mixer in"]["channels"] == {"in": 2, "out": 1}
    assert conf["mixers"]["Mixer out"]["channels"] == {"in": 1, "out": 3}
    assert conf["pipeline"] == expected_pipeline


def test_simple_impulse_response():
    convolver_config = clean_multi_line_string(
        """
        0 1 1 0
        0
        0
        IR.wav
        0
        0.0
        0.0
    """
    )

    expected_filters = {
        "IR.wav-0": {
            "type": "Conv",
            "parameters": {"type": "Wav", "filename": "IR.wav", "channel": 0},
        }
    }
    expected_pipeline = [
        {"type": "Mixer", "name": "Mixer in", "description": None},
        {
            "type": "Filter",
            "channel": 0,
            "names": ["IR.wav-0"],
            "bypassed": None,
            "description": None,
        },
        {"type": "Mixer", "name": "Mixer out", "description": None},
    ]

    conf = ConvolverConfig(convolver_config).to_object()
    assert conf["pipeline"] == expected_pipeline
    assert conf["filters"] == expected_filters


def test_path_is_ignored_for_impulse_response_files():
    convolver_config = clean_multi_line_string(
        """
        0 1 1 0
        0
        0
        IR1.wav
        0
        0.0
        0.0
        C:\\any/path/IR2.wav
        0
        0.0
        0.0
        /some/other/path/IR3.wav
        0
        0.0
        0.0
    """
    )
    conf = ConvolverConfig(convolver_config).to_object()
    assert conf["filters"]["IR1.wav-0"]["parameters"]["filename"] == "IR1.wav"
    assert conf["filters"]["IR2.wav-0"]["parameters"]["filename"] == "IR2.wav"
    assert conf["filters"]["IR3.wav-0"]["parameters"]["filename"] == "IR3.wav"


def test_wav_file_with_multiple_impulse_responses():
    convolver_config = clean_multi_line_string(
        """
        0 1 1 0
        0
        0
        IR.wav
        0
        0.0
        0.0
        IR.wav
        1
        0.0
        0.0
    """
    )
    conf = ConvolverConfig(convolver_config).to_object()
    assert conf["filters"]["IR.wav-0"]["parameters"]["channel"] == 0
    assert conf["filters"]["IR.wav-1"]["parameters"]["channel"] == 1


def test_impulse_responses_are_mapped_to_correct_channels():
    convolver_config = clean_multi_line_string(
        """
        0 1 1 0
        0
        0
        IR1.wav
        0
        0.0
        0.0
        IR2.wav
        0
        0.0
        0.0
    """
    )

    expected = [
        {"type": "Mixer", "name": "Mixer in", "description": None},
        {
            "type": "Filter",
            "channel": 0,
            "names": ["IR1.wav-0"],
            "bypassed": None,
            "description": None,
        },
        {
            "type": "Filter",
            "channel": 1,
            "names": ["IR2.wav-0"],
            "bypassed": None,
            "description": None,
        },
        {"type": "Mixer", "name": "Mixer out", "description": None},
    ]

    conf = ConvolverConfig(convolver_config).to_object()
    result = conf["pipeline"]
    assert result == expected


def test_impulse_response_with_input_scaling():
    convolver_config = clean_multi_line_string(
        """
        0 2 2 0
        0 0
        0 0
        IR.wav
        0
        0.0 1.1
        0.0
        IR.wav
        1
        0.2 1.3
        0.0
        IR.wav
        2
        -1.5 -0.4
        0.0
    """
    )
    expected = {
        "channels": {"in": 2, "out": 3},
        "mapping": [
            {
                "dest": 0,
                "sources": [
                    {
                        "channel": 0,
                        "gain": 1.0,
                        "scale": "linear",
                        "inverted": False,
                    },
                    {
                        "channel": 1,
                        "gain": 0.1,
                        "scale": "linear",
                        "inverted": False,
                    },
                ],
            },
            {
                "dest": 1,
                "sources": [
                    {
                        "channel": 0,
                        "gain": 0.2,
                        "scale": "linear",
                        "inverted": False,
                    },
                    {
                        "channel": 1,
                        "gain": 0.3,
                        "scale": "linear",
                        "inverted": False,
                    },
                ],
            },
            {
                "dest": 2,
                "sources": [
                    {
                        "channel": 1,
                        "gain": 0.5,
                        "scale": "linear",
                        "inverted": True,
                    },
                    {
                        "channel": 0,
                        "gain": 0.4,
                        "scale": "linear",
                        "inverted": True,
                    },
                ],
            },
        ],
    }
    conf = ConvolverConfig(convolver_config).to_object()
    result = conf["mixers"]["Mixer in"]
    assert result == expected


def test_impulse_response_with_output_scaling():
    convolver_config = clean_multi_line_string(
        """
        0 2 2 0
        0 0
        0 0
        IR.wav
        0
        0.0
        0.0 1.1
        IR.wav
        1
        0.0
        0.2 1.3
        IR.wav
        2
        0.0
        -1.5 -0.4
    """
    )
    expected_mixer = {
        "channels": {"in": 3, "out": 2},
        "mapping": [
            {
                "dest": 0,
                "sources": [
                    {
                        "channel": 0,
                        "gain": 1.0,
                        "scale": "linear",
                        "inverted": False,
                    },
                    {
                        "channel": 1,
                        "gain": 0.2,
                        "scale": "linear",
                        "inverted": False,
                    },
                    {
                        "channel": 2,
                        "gain": 0.4,
                        "scale": "linear",
                        "inverted": True,
                    },
                ],
            },
            {
                "dest": 1,
                "sources": [
                    {
                        "channel": 0,
                        "gain": 0.1,
                        "scale": "linear",
                        "inverted": False,
                    },
                    {
                        "channel": 1,
                        "gain": 0.3,
                        "scale": "linear",
                        "inverted": False,
                    },
                    {
                        "channel": 2,
                        "gain": 0.5,
                        "scale": "linear",
                        "inverted": True,
                    },
                ],
            },
        ],
    }

    conf = ConvolverConfig(convolver_config).to_object()
    assert conf["mixers"]["Mixer out"] == expected_mixer
