"""In-process code kernel — persistent namespace, like Jupyter cells.

Captures stdout/stderr, renders the last expression, DataFrames as HTML, and
matplotlib figures as inline PNGs. genai_trader is preloaded so pasted lesson
code runs immediately.

Runs arbitrary Python with no sandboxing — LOCAL, single-user use only.
"""
from __future__ import annotations

import ast
import base64
import io
import traceback
from contextlib import redirect_stderr, redirect_stdout
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402


class KernelSession:
    def __init__(self) -> None:
        self.namespace: dict[str, Any] = {}
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
        out, err = io.StringIO(), io.StringIO()
        result_value: Any = None
        error_text: str | None = None

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

        try:
            with redirect_stdout(out), redirect_stderr(err):
                if body:
                    exec(compile(ast.Module(body, []), "<cell>", "exec"), self.namespace)
                if last_expr is not None:
                    result_value = eval(
                        compile(last_expr, "<cell>", "eval"), self.namespace
                    )
        except Exception:
            error_text = traceback.format_exc()

        figures = self._capture_figures()
        result_html, result_text = self._render_value(result_value)
        return {
            "ok": error_text is None,
            "stdout": out.getvalue() + err.getvalue(),
            "error": error_text,
            "result_html": result_html,
            "result_text": result_text,
            "figures": figures,
        }

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
