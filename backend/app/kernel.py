"""In-process code kernel — persistent namespace, like Jupyter cells.

Captures stdout/stderr, renders the last expression, DataFrames as HTML, and
matplotlib figures as inline PNGs. genai_trader is preloaded so pasted lesson
code runs immediately.

Runs arbitrary Python with no sandboxing — LOCAL, single-user use only.
"""
from __future__ import annotations

import ast
import base64
import importlib
import io
import subprocess
import sys
import traceback
from contextlib import redirect_stderr, redirect_stdout
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

# Import names that don't match their pip package name — without this, an
# auto-install attempt for e.g. "import sklearn" would try `pip install
# sklearn` (a different, mostly-empty package) instead of scikit-learn.
_PIP_NAME_ALIASES = {
    "sklearn": "scikit-learn",
    "cv2": "opencv-python",
    "PIL": "Pillow",
    "yaml": "PyYAML",
    "bs4": "beautifulsoup4",
    "dateutil": "python-dateutil",
    "sm": "statsmodels",
}

MAX_AUTO_INSTALLS_PER_RUN = 4  # a factor model might need statsmodels + scipy + ...


class KernelSession:
    def __init__(self) -> None:
        self.namespace: dict[str, Any] = {}
        self._install_attempted: set[str] = set()  # avoid retry-looping a failed install
        self.reset()

    def reset(self) -> None:
        ns: dict[str, Any] = {"__name__": "__main__"}
        exec(
            "import pandas as pd\n"
            "import numpy as np\n"
            "import matplotlib.pyplot as plt\n"
            "import genai_trader as gt\n"
            "from genai_trader import (get_adjusted_close, get_last_n_trading_days,\n"
            "    daily_returns, sharpe_ratio, cumulative_returns)\n",
            ns,
        )
        self.namespace = ns

    def run(self, code: str) -> dict:
        plt.close("all")

        try:
            parsed = ast.parse(code, mode="exec")
        except SyntaxError:
            return {
                "ok": False, "stdout": "", "error": traceback.format_exc(limit=1),
                "result_html": None, "result_text": None, "figures": [],
            }

        last_expr: ast.Expression | None = None
        body = parsed.body
        if body and isinstance(body[-1], ast.Expr):
            last = body.pop()
            last_expr = ast.Expression(last.value)
        compiled_body = compile(ast.Module(body, []), "<cell>", "exec") if body else None
        compiled_last = compile(last_expr, "<cell>", "eval") if last_expr is not None else None

        install_log: list[str] = []
        attempts = 0
        while True:
            out, err = io.StringIO(), io.StringIO()
            result_value: Any = None
            error_text: str | None = None
            try:
                with redirect_stdout(out), redirect_stderr(err):
                    if compiled_body is not None:
                        exec(compiled_body, self.namespace)
                    if compiled_last is not None:
                        result_value = eval(compiled_last, self.namespace)
            except ModuleNotFoundError as exc:
                attempts += 1
                installed = attempts <= MAX_AUTO_INSTALLS_PER_RUN and self._auto_install(exc.name)
                if installed:
                    install_log.append(f"[auto-installed missing package '{exc.name}' — re-running]")
                    continue  # retry the same code now that the package exists
                error_text = (
                    f"{traceback.format_exc()}\n"
                    f"(tried to auto-install '{exc.name}' and it either failed or was already "
                    "attempted this run — see stdout above for pip's output, or install it "
                    "yourself: pip install " + _PIP_NAME_ALIASES.get(exc.name or "", exc.name or "") + ")"
                )
            except Exception:
                error_text = traceback.format_exc()
            break

        figures = self._capture_figures()
        result_html, result_text = self._render_value(result_value)
        stdout = ("\n".join(install_log) + "\n" if install_log else "") + out.getvalue() + err.getvalue()
        return {
            "ok": error_text is None,
            "stdout": stdout,
            "error": error_text,
            "result_html": result_html,
            "result_text": result_text,
            "figures": figures,
        }

    def _auto_install(self, module_name: str | None) -> bool:
        """Best-effort `pip install` of a module that a cell tried to import
        but isn't present, so a missing package fails a run at most once
        instead of every time. Only attempted once per module per server
        process — if it fails (no internet, name mismatch, compiled
        dependency, etc.) it won't keep retrying and stalling every run."""
        if not module_name or module_name in self._install_attempted:
            return False
        self._install_attempted.add(module_name)
        pip_name = _PIP_NAME_ALIASES.get(module_name, module_name)
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", "-q", pip_name],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode == 0:
                importlib.invalidate_caches()
                return True
            return False
        except Exception:
            return False

    @staticmethod
    def _capture_figures() -> list[str]:
        figs = []
        for num in plt.get_fignums():
            fig = plt.figure(num)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
            buf.seek(0)
            figs.append(base64.b64encode(buf.read()).decode("ascii"))
        plt.close("all")
        return figs

    @staticmethod
    def _render_value(value: Any) -> tuple[str | None, str | None]:
        if value is None:
            return None, None
        if isinstance(value, (pd.DataFrame, pd.Series)):
            frame = value.to_frame() if isinstance(value, pd.Series) else value
            return frame.to_html(max_rows=200, border=0), None
        return None, repr(value)
