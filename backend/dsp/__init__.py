"""
Config validation for CamillaDSP configs.

Merged into the GUI backend from the pycamilladsp-plot library, which is
deprecated as of CamillaDSP 5.0. Only the parts the GUI needs were carried
over, so the standalone plotting (matplotlib) is gone.

Filter evaluation used to live here too. It now runs in the browser, in
`camillagui/src/camilladsp/eval/`, so the backend keeps only what genuinely
needs a server: reading files off disk and validating configs.
"""

from .validate_config import CamillaValidator

__all__ = ["CamillaValidator"]
