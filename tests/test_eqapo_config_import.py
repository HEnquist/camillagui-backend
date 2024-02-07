import pytest

from backend.eqapo_config_import import EqAPO

EXAMPLE = """
Device: High Definition Audio Device Speakers; Benchmark
#All lines below will only be applied to the specified device and the benchmark application
Preamp: -6 db
Include: example.txt
Filter  1: ON  PK       Fc     50 Hz   Gain  -3.0 dB  Q 10.00
Filter  2: ON  PEQ      Fc     100 Hz  Gain   1.0 dB  BW Oct 0.167

Channel: L
#Additional preamp for left channel
Preamp: -5 dB
#Filters only for left channel
Include: demo.txt
Filter  1: ON  LS       Fc     300 Hz  Gain   5.0 dB

Channel: 2 C
#Filters for second(right) and center channel
Filter  1: ON  HP       Fc     30 Hz
Filter  2: ON  LPQ      Fc     10000 Hz  Q  0.400

Device: Microphone
#From here, the lines only apply to microphone devices
Filter: ON  NO       Fc     50 Hz
"""


@pytest.fixture
def eqapo():
    converter = EqAPO(EXAMPLE, 2)
    yield converter


PK_EQAPO = "Filter  1: ON  PK       Fc     50 Hz   Gain  -3.0 dB  Q 10.00"
PK_CDSP = {"freq": 50.0, "gain": -3.0, "q": 10.0, "type": "Peaking"}

PEQ_EQAPO = "Filter  2: ON  PEQ      Fc     100 Hz  Gain   1.0 dB  BW Oct 0.167"
PEQ_CDSP = {"freq": 100.0, "gain": 1.0, "bandwidth": 0.167, "type": "Peaking"}

@pytest.mark.parametrize(
    "filterline, expected_params",
    [
        (PK_EQAPO, PK_CDSP),
        (PEQ_EQAPO, PEQ_CDSP)
    ],
)
def test_single_filter(eqapo, filterline, expected_params):
    eqapo.parse_line(filterline)
    name, filt = next(iter(eqapo.filters.items()))
    assert filt["parameters"] == expected_params
    assert name == "Filter_1"


SIMPLE_CONV_EQAPO = """
Channel: L
Convolution: L.wav
Channel: R
Convolution: R.wav
"""

SIMPLE_CONV_CDSP = {
    "filters": {
        "Convolution_1": {
            "type": "Conv",
            "parameters": {"filename": "L.wav", "type": "wav"},
            "description": "Convolution: L.wav",
        },
        "Convolution_2": {
            "type": "Conv",
            "parameters": {"filename": "R.wav", "type": "wav"},
            "description": "Convolution: R.wav",
        },
    },
    "mixers": {},
    "pipeline": [
        {
            "type": "Filter",
            "names": ["Convolution_1"],
            "description": "Channel: L",
            "channel": 0,
        },
        {
            "type": "Filter",
            "names": ["Convolution_2"],
            "description": "Channel: R",
            "channel": 1,
        },
    ],
}


def test_simple_conv():
    converter = EqAPO(SIMPLE_CONV_EQAPO, 2)
    converter.translate_file()
    conf = converter.build_config()
    assert conf == SIMPLE_CONV_CDSP


CROSSOVER_EQAPO = """
Copy: RL=L RR=R
Channel: L R
Filter  1: ON  LP       Fc     2000 Hz
Channel: RL RR
Filter  2: ON  HP       Fc     2000 Hz
"""

CROSSOVER_CDSP = {
    "filters": {
        "Filter_1": {
            "type": "Biquad",
            "parameters": {"type": "Lowpass", "freq": 2000.0},
            "description": "Filter  1: ON  LP       Fc     2000 Hz",
        },
        "Filter_2": {
            "type": "Biquad",
            "parameters": {"type": "Highpass", "freq": 2000.0},
            "description": "Filter  2: ON  HP       Fc     2000 Hz",
        },
    },
    "mixers": {
        "Copy_1": {
            "channels": {"in": 4, "out": 4},
            "mapping": [
                {
                    "dest": 2,
                    "mute": False,
                    "sources": [
                        {"channel": 0, "gain": 0, "inverted": False, "scale": "dB"}
                    ],
                },
                {
                    "dest": 3,
                    "mute": False,
                    "sources": [
                        {"channel": 1, "gain": 0, "inverted": False, "scale": "dB"}
                    ],
                },
                {
                    "dest": 0,
                    "mute": False,
                    "sources": [
                        {
                            "channel": 0,
                            "gain": 0.0,
                            "inverted": False,
                            "scale": "dB",
                        }
                    ],
                },
                {
                    "dest": 1,
                    "mute": False,
                    "sources": [
                        {
                            "channel": 1,
                            "gain": 0.0,
                            "inverted": False,
                            "scale": "dB",
                        }
                    ],
                },
            ],
            "description": "Copy: RL=L RR=R",
        }
    },
    "pipeline": [
        {"type": "Mixer", "name": "Copy_1"},
        {
            "type": "Filter",
            "names": ["Filter_1"],
            "description": "Channel: L R",
            "channel": 0,
        },
        {
            "type": "Filter",
            "names": ["Filter_1"],
            "description": "Channel: L R",
            "channel": 1,
        },
        {
            "type": "Filter",
            "names": ["Filter_2"],
            "description": "Channel: RL RR",
            "channel": 2,
        },
        {
            "type": "Filter",
            "names": ["Filter_2"],
            "description": "Channel: RL RR",
            "channel": 3,
        },
    ],
}


def test_crossover():
    converter = EqAPO(CROSSOVER_EQAPO, 4)
    converter.translate_file()
    conf = converter.build_config()
    assert conf == CROSSOVER_CDSP
