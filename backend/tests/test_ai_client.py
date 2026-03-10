import json
from typing import Any
from urllib.error import HTTPError

import pytest

from app.ai_client import AIClientConfigError, AIClientUpstreamError, request_chat_completion


class DummyResponse:
    def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
        self._status_code = status_code
        self._payload = payload

    def getcode(self) -> int:
        return self._status_code

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self) -> "DummyResponse":
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        return None


def test_request_chat_completion_builds_openrouter_request_and_parses_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "openrouter/free")
    monkeypatch.setenv("OPENROUTER_TIMEOUT_SECONDS", "13")

    captured: dict[str, Any] = {}

    def fake_urlopen(req: Any, timeout: float) -> DummyResponse:
        captured["url"] = req.full_url
        captured["headers"] = dict(req.header_items())
        captured["json"] = json.loads(req.data.decode("utf-8"))
        captured["timeout"] = timeout
        return DummyResponse(200, {"choices": [{"message": {"content": "4"}}]})

    monkeypatch.setattr("app.ai_client.urllib.request.urlopen", fake_urlopen)

    result = request_chat_completion("2+2")
    assert result == "4"
    assert captured["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["json"]["model"] == "openrouter/free"
    assert captured["json"]["messages"] == [{"role": "user", "content": "2+2"}]
    assert captured["json"]["temperature"] == 0
    assert captured["timeout"] == 13.0


def test_request_chat_completion_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    with pytest.raises(AIClientConfigError, match="OPENROUTER_API_KEY is not configured"):
        request_chat_completion("2+2")


def test_request_chat_completion_maps_error_status(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    def fake_urlopen(req: Any, timeout: float) -> DummyResponse:
        raise HTTPError(
            url=req.full_url,
            code=401,
            msg="Unauthorized",
            hdrs=None,
            fp=None,
        )

    monkeypatch.setattr("app.ai_client.urllib.request.urlopen", fake_urlopen)

    with pytest.raises(AIClientUpstreamError, match="status 401"):
        request_chat_completion("2+2")
