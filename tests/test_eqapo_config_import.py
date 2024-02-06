import pytest

from backend.eqapo_config_import import (
    EqAPO
)

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


def test_single_filter(eqapo):
    line = "Filter  1: ON  PK       Fc     50 Hz   Gain  -3.0 dB  Q 10.00"
    filt = eqapo.parse_line(line)
    assert filter == None
    