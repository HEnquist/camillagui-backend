"""
Config validation and filter evaluation for CamillaDSP configs.

Merged into the GUI backend from the pycamilladsp-plot library, which is
deprecated as of CamillaDSP 5.0. Only the parts the GUI needs were carried
over, so the standalone plotting (matplotlib) is gone.
"""

from .eval_filterconfig import eval_filter, eval_filterstep
from .validate_config import CamillaValidator

__all__ = ["eval_filter", "eval_filterstep", "CamillaValidator"]
