import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.ai_client import AIClientConfigError, AIClientUpstreamError


@pytest.fixture
def isolated_db_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    db_path = tmp_path / "data" / "pm.sqlite3"
    monkeypatch.setenv("DATABASE_PATH", str(db_path))
    return db_path


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.delenv("SESSION_SECRET", raising=False)

    from app.main import create_app

    return TestClient(create_app())


def login(client: TestClient) -> None:
    response = client.post(
        "/api/login",
        json={"username": "user", "password": "password"},
    )
    assert response.status_code == 200


def create_board_update_payload(client: TestClient) -> dict:
    payload = client.get("/api/board").json()
    return {
        "board": payload["board"],
        "version": payload["version"],
    }


def test_create_app_requires_session_secret_outside_test_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SESSION_SECRET", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)

    existing_module = sys.modules.pop("app.main", None)

    try:
        with pytest.raises(RuntimeError, match="SESSION_SECRET must be set"):
            importlib.import_module("app.main")
    finally:
        sys.modules.pop("app.main", None)
        if existing_module is not None:
            sys.modules["app.main"] = existing_module


def test_root_serves_html(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "<html" in response.text


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_session_is_unauthenticated_by_default(client: TestClient) -> None:
    response = client.get("/api/session")
    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "username": None}


def test_login_with_valid_credentials_sets_session(client: TestClient) -> None:
    response = client.post("/api/login", json={"username": "user", "password": "password"})
    assert response.status_code == 200
    assert response.json() == {"authenticated": True, "username": "user"}
    assert "session=" in response.headers.get("set-cookie", "")

    session_response = client.get("/api/session")
    assert session_response.status_code == 200
    assert session_response.json() == {"authenticated": True, "username": "user"}


def test_login_with_invalid_credentials_returns_401(client: TestClient) -> None:
    response = client.post("/api/login", json={"username": "user", "password": "wrong"})
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid credentials"}


def test_logout_clears_session(client: TestClient) -> None:
    login(client)

    logout_response = client.post("/api/logout")
    assert logout_response.status_code == 200
    assert logout_response.json() == {"authenticated": False}

    session_response = client.get("/api/session")
    assert session_response.status_code == 200
    assert session_response.json() == {"authenticated": False, "username": None}


def test_board_routes_require_authentication(client: TestClient) -> None:
    get_response = client.get("/api/board")
    assert get_response.status_code == 401
    assert get_response.json() == {"detail": "Unauthorized"}

    put_response = client.put("/api/board", json={"board": {"columns": [], "cards": {}}, "version": 0})
    assert put_response.status_code == 401
    assert put_response.json() == {"detail": "Unauthorized"}


def test_get_board_creates_database_and_returns_default_board(
    client: TestClient,
    isolated_db_path: Path,
) -> None:
    login(client)

    response = client.get("/api/board")
    assert response.status_code == 200

    payload = response.json()
    assert payload["version"] == 1
    assert len(payload["board"]["columns"]) == 5
    assert "card-1" in payload["board"]["cards"]
    assert isolated_db_path.exists()


def test_put_board_updates_and_persists_board_data(
    client: TestClient,
    isolated_db_path: Path,
) -> None:
    login(client)

    update_payload = create_board_update_payload(client)
    update_payload["board"]["columns"][0]["title"] = "Renamed Backlog"

    update_response = client.put("/api/board", json=update_payload)
    assert update_response.status_code == 200
    assert update_response.json()["version"] == 2

    read_back = client.get("/api/board")
    assert read_back.status_code == 200
    assert read_back.json()["board"]["columns"][0]["title"] == "Renamed Backlog"
    assert read_back.json()["version"] == 2


def test_put_board_rejects_stale_version(
    client: TestClient,
    isolated_db_path: Path,
) -> None:
    login(client)

    initial_payload = create_board_update_payload(client)
    initial_payload["board"]["columns"][0]["title"] = "First update"
    first_update = client.put("/api/board", json=initial_payload)
    assert first_update.status_code == 200

    stale_payload = create_board_update_payload(client)
    stale_payload["version"] = 1
    stale_payload["board"]["columns"][0]["title"] = "Stale update"

    stale_response = client.put("/api/board", json=stale_payload)
    assert stale_response.status_code == 409
    assert "Expected version 1, current version 2" in stale_response.json()["detail"]


def test_put_board_rejects_invalid_payload(
    client: TestClient,
    isolated_db_path: Path,
) -> None:
    login(client)

    update_payload = create_board_update_payload(client)
    update_payload["board"]["columns"][0]["cardIds"].append("missing-card")

    response = client.put("/api/board", json=update_payload)
    assert response.status_code == 422
    assert "Unknown card ids referenced by columns" in response.json()["detail"]


def test_board_data_persists_across_clients(
    isolated_db_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.delenv("SESSION_SECRET", raising=False)

    from app.main import create_app

    first_client = TestClient(create_app())
    login(first_client)

    update_payload = create_board_update_payload(first_client)
    update_payload["board"]["columns"][0]["title"] = "Persistent Title"
    update_response = first_client.put("/api/board", json=update_payload)
    assert update_response.status_code == 200

    second_client = TestClient(create_app())
    login(second_client)
    persisted_response = second_client.get("/api/board")
    assert persisted_response.status_code == 200
    assert persisted_response.json()["board"]["columns"][0]["title"] == "Persistent Title"


def test_chat_route_requires_authentication(client: TestClient) -> None:
    response = client.post("/api/chat", json={"message": "2+2"})
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_chat_route_returns_message_and_empty_operations(
    client: TestClient,
    isolated_db_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.chat_service.request_chat_completion",
        lambda _: '{"message":"4","operations":[]}',
    )

    login(client)

    response = client.post("/api/chat", json={"message": "2+2"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["message"] == "4"
    assert payload["operations"] == []
    assert "board" in payload
    assert payload["version"] == 1


def test_chat_route_maps_missing_key_to_500(
    client: TestClient,
    isolated_db_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def raise_config_error(_: str) -> str:
        raise AIClientConfigError("OPENROUTER_API_KEY is not configured.")

    monkeypatch.setattr("app.chat_service.request_chat_completion", raise_config_error)

    login(client)

    response = client.post("/api/chat", json={"message": "2+2"})
    assert response.status_code == 500
    assert response.json() == {"detail": "OPENROUTER_API_KEY is not configured."}


def test_chat_route_maps_upstream_failure_to_502(
    client: TestClient,
    isolated_db_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def raise_upstream_error(_: str) -> str:
        raise AIClientUpstreamError("OpenRouter request failed with status 401.")

    monkeypatch.setattr("app.chat_service.request_chat_completion", raise_upstream_error)

    login(client)

    response = client.post("/api/chat", json={"message": "2+2"})
    assert response.status_code == 502
    assert response.json() == {"detail": "OpenRouter request failed with status 401."}


def test_chat_route_rejects_invalid_structured_response(
    client: TestClient,
    isolated_db_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.chat_service.request_chat_completion", lambda _: "not json")

    login(client)

    response = client.post("/api/chat", json={"message": "create a card"})
    assert response.status_code == 502
    assert response.json() == {"detail": "AI response is not JSON."}


def test_chat_route_applies_operations_and_persists_board(
    client: TestClient,
    isolated_db_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.chat_service.request_chat_completion",
        lambda _: (
            '{"message":"Created one card","operations":'
            '[{"type":"create","title":"AI Card","details":"from ai","columnId":"col-backlog"}]}'
        ),
    )

    login(client)

    before = client.get("/api/board").json()
    assert before["version"] == 1

    chat_response = client.post("/api/chat", json={"message": "create a card in backlog"})
    assert chat_response.status_code == 200
    chat_payload = chat_response.json()
    assert chat_payload["message"] == "Created one card"
    assert chat_payload["version"] == 2
    assert len(chat_payload["operations"]) == 1
    created_operation = chat_payload["operations"][0]
    assert created_operation["type"] == "create"

    card_id = created_operation["cardId"]
    persisted = client.get("/api/board").json()
    assert persisted["version"] == 2
    assert card_id in persisted["board"]["cards"]
    assert persisted["board"]["cards"][card_id]["title"] == "AI Card"
