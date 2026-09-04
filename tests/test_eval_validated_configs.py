"""Check that the frontend's evaluator is kept in step with the filter schemas.

The filter evaluator used to live here, and this file used to feed it every
config the schemas allow. The evaluator now runs in the browser, so the check
is split in two: `tools/dump_filter_variants.py` exports the variants, and the
frontend's `variants.test.ts` evaluates them.

This test guards the handover. It fails when the schemas have changed but the
exported variants have not, which is the one way the coupling could silently
rot: a new filter parameter would otherwise reach the GUI without anything
proving the evaluator understands it.
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "tools"))

from dump_filter_variants import DEFAULT_OUTPUT, build_variants  # noqa: E402


def test_exported_variants_match_the_schemas():
    if not DEFAULT_OUTPUT.is_file():
        pytest.skip(
            f"no frontend checkout at {DEFAULT_OUTPUT}, nothing to compare against"
        )
    exported = json.loads(DEFAULT_OUTPUT.read_text())
    current = build_variants()
    assert exported == current, (
        "The filter schemas no longer match the variants exported to the "
        "frontend. Run 'python tools/dump_filter_variants.py' and commit the "
        "result, so the frontend's evaluator is tested against the new schema."
    )
