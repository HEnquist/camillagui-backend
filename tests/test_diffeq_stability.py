"""Check the DiffEq pole test the validator uses.

This used to sit in test_filter_evaluation.py, next to the filter evaluator.
The evaluator moved to the frontend; diffeq_is_stable did not, because it is a
validation check rather than a transfer function, so it stayed with the
validator and so did its tests.
"""

import numpy as np
import pytest

from backend.dsp.validate_config import diffeq_is_stable


def _schur_cohn(a):
    """
    Port of `poles_inside_unit_circle` from CamillaDSP's src/filters/diffeq.rs,
    used here only as an independent reference for diffeq_is_stable.
    """
    coeffs = list(a)
    for order in range(len(coeffs) - 1, 0, -1):
        reflection = coeffs[order]
        if abs(reflection) >= 1.0:
            return False
        scale = 1.0 - reflection * reflection
        prev = list(coeffs)
        for n in range(1, order):
            coeffs[n] = (prev[n] - reflection * prev[order - n]) / scale
        coeffs = coeffs[:order]
    return True


def test_diffeq_is_stable_agrees_with_the_dsp_algorithm():
    # The DSP uses Schur-Cohn to avoid root finding, the GUI uses np.roots.
    # They must reach the same verdict, including near the unit circle.
    rng = np.random.default_rng(0)
    for order in range(1, 9):
        for _ in range(500):
            spread = 1.15 if rng.random() < 0.5 else 1.001
            a = np.poly(rng.uniform(-spread, spread, order))

            assert diffeq_is_stable(a) == _schur_cohn(list(a)), list(a)


@pytest.mark.parametrize(
    "a,expected",
    [
        ([], True),
        ([1.0], True),
        ([1.0, 0.0], True),
        ([1.0, -2.0, 1.0], False),
        ([1.0, 0.0, -1.0], False),
        ([1.0, -1.9999999, 0.99999999], True),
    ],
)
def test_diffeq_is_stable_boundary_cases(a, expected):
    assert diffeq_is_stable(a) is expected
