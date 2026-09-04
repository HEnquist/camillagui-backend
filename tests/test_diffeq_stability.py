"""Check the DiffEq pole test the validator uses.

This used to sit in test_filter_evaluation.py, next to the filter evaluator.
The evaluator moved to the frontend; diffeq_is_stable did not, because it is a
validation check rather than a transfer function, so it stayed with the
validator and so did its tests.

diffeq_is_stable is itself the Schur-Cohn test now, so checking it against a
second copy of Schur-Cohn would prove nothing. The reference here is a
polynomial built from roots at a chosen radius, where the answer is known
before any of it runs.
"""

import math

import pytest

from backend.dsp.validate_config import diffeq_is_stable


def _polynomial_with_roots_at(radius, pairs):
    """
    A real polynomial whose roots all sit at the given distance from the origin,
    so whether it is stable is known by construction rather than measured.

    The roots are spread around the circle in conjugate pairs, which is what
    keeps the coefficients real. The result has degree 2 * pairs, in the
    descending order that the 'a' coefficients of a DiffEq are written in.
    """
    roots = []
    for n in range(pairs):
        angle = math.pi * (n + 1) / (pairs + 1)
        root = complex(radius * math.cos(angle), radius * math.sin(angle))
        roots += [root, root.conjugate()]
    coeffs = [1.0 + 0j]
    for root in roots:
        # multiply by (x - root)
        product = [0j] * (len(coeffs) + 1)
        for n, c in enumerate(coeffs):
            product[n] += c
            product[n + 1] -= root * c
        coeffs = product
    return [c.real for c in coeffs]


@pytest.mark.parametrize("pairs", [1, 2, 3, 4])
# the radii near 1 are the ones that matter: they are close enough to the circle
# that any drift in the step-down arithmetic flips the verdict
@pytest.mark.parametrize(
    "radius", [0.1, 0.5, 0.9, 0.99, 0.9999, 0.999999, 1.000001, 1.0001, 1.01, 1.5, 3.0]
)
def test_diffeq_is_stable_matches_roots_of_a_known_radius(pairs, radius):
    # every root is this far out, so the verdict follows from the radius alone
    a = _polynomial_with_roots_at(radius, pairs)
    assert diffeq_is_stable(a) is (radius < 1.0)


def _polynomial_from_radii(radii):
    """A real polynomial with one conjugate pair of roots at each radius."""
    coeffs = [1.0 + 0j]
    for n, radius in enumerate(radii):
        angle = math.pi * (n + 1) / (len(radii) + 1)
        root = complex(radius * math.cos(angle), radius * math.sin(angle))
        for r in (root, root.conjugate()):
            product = [0j] * (len(coeffs) + 1)
            for i, c in enumerate(coeffs):
                product[i] += c
                product[i + 1] -= r * c
            coeffs = product
    return [c.real for c in coeffs]


@pytest.mark.parametrize(
    "radii,expected",
    [
        ([0.4, 0.4, 1.2], False),
        ([0.3, 0.5, 0.7, 1.05], False),
        ([0.2, 0.2, 0.2, 1.001], False),
        ([0.4, 0.4, 0.95], True),
        ([0.3, 0.5, 0.7, 0.99], True),
    ],
)
def test_diffeq_is_stable_finds_a_root_the_first_step_cannot_see(radii, expected):
    """
    The first coefficient examined is the product of all the roots, so a single
    root just outside the circle among several well inside it is hidden behind a
    product below 1. Finding it is the step-down recursion doing its job, which
    nothing else here exercises.
    """
    a = _polynomial_from_radii(radii)
    assert abs(a[-1]) < 1.0, "the test is pointless unless the first check passes"
    assert diffeq_is_stable(a) is expected


def test_diffeq_is_stable_ignores_the_overall_scale():
    # a[0] need not be unity here, the way it must be in the Rust
    a = _polynomial_with_roots_at(0.9, 3)
    for scale in (2.0, -1.0, 1e6, 1e-6):
        assert diffeq_is_stable([scale * v for v in a]) is True


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
