"""Standard API response envelope (control_deck convention).

    { "success": bool, "data": {...}, "message": str, "timestamp": ISO8601 }
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from fastapi.responses import JSONResponse


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def ok(data: Any = None, message: str = "Success", status: int = 200) -> JSONResponse:
    return JSONResponse(
        {"success": True, "data": data, "message": message, "timestamp": _now()},
        status_code=status,
    )


def err(message: str, status: int = 400, data: Any = None) -> JSONResponse:
    return JSONResponse(
        {"success": False, "data": data, "message": message, "timestamp": _now()},
        status_code=status,
    )
