from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.ai_client import AIClientConfigError, AIClientUpstreamError
from app.main import app


@pytest.fixture
def isolated_db_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    db_path = tmp_path / "data" / "pm.sqlite3"
    monkeypatch.setenv("DATABASE_PATH", str(db_path))
    return db_path


def login(client: TestClient) -> None:
    response = client.post(
        "/api/login",
        json={"username": "user", "password": "password"},
    )
    assert response.status_code == 200


def test_root_serves_html() -> None:
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "<html" in response.text


def test_health_endpoint() -> None:
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_session_is_unauthenticated_by_default() -> None:
    client = TestClient(app)
    response = client.get("/api/session")
    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "username": None}


def test_login_with_valid_credentials_sets_session() -> None:
    client = TestClient(app)
    response = client.post("/api/login", json={"username": "user", "password": "password"})
    assert response.status_code == 200
    assert response.json() == {"authenticated": True, "username": "user"}
    assert "session=" in response.headers.get("set-cookie", "")

    session_response = client.get("/api/session")
    assert session_response.status_code == 200
    assert session_response.json() == {"authenticated": True, "username": "user"}


def test_login_with_invalid_credentials_returns_401() -> None:
    client = TestClient(app)
    response = client.post("/api/login", json={"username": "user", "password": "wrong"})
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid credentials"}


def test_logout_clears_session() -> None:
    client = TestClient(app)
    login(client)

    logout_response = client.post("/api/logout")
    assert logout_response.status_code == 200
    assert logout_response.json() == {"authenticated": False}

    session_response = client.get("/api/session")
    assert session_response.status_code == 200
    assert session_response.json() == {"authenticated": False, "username": None}


def test_board_routes_require_authentication() -> None:
    client = TestClient(app)

    get_response = client.get("/api/board")
    assert get_response.status_code == 401
    assert get_response.json() == {"detail": "Unauthorized"}

    put_response = client.put("/api/board", json={"columns": [], "cards": {}})
    assert put_response.status_code == 401
    assert put_response.json() == {"detail": "Unauthorized"}


def test_get_board_creates_database_and_returns_default_board(
    isolated_db_path: Path,
) -> None:
    client = TestClient(app)
    login(client)

    response = client.get("/api/board")
    assert response.status_code == 200

    payload = response.json()
    assert payload["version"] == 1
    assert len(payload["board"]["columns"]) == 5
    assert "card-1" in payload["board"]["cards"]
    assert isolated_db_path.exists()


def test_put_board_updates_and_persists_board_data(isolated_db_path: Path) -> None:
    client = TestClient(app)
    login(client)

    initial = client.get("/api/board").json()
    board = initial["board"]
    board["columns"][0]["title"] = "Renamed Backlog"

    update_response = client.put("/api/board", json=board)
    assert update_response.status_code == 200
    assert update_response.json()["version"] == 2

    read_back = client.get("/api/board")
    assert read_back.status_code == 200
    assert read_back.json()["board"]["columns"][0]["title"] == "Renamed Backlog"
    assert read_back.json()["version"] == 2


def test_put_board_rejects_invalid_payload(isolated_db_path: Path) -> None:
    client = TestClient(app)
    login(client)

    board = client.get("/api/board").json()["board"]
    board["columns"][0]["cardIds"].append("missing-card")

    response = client.put("/api/board", json=board)
    assert response.status_code == 422
    assert "Unknown card ids referenced by columns" in response.json()["detail"]


def test_board_data_persists_across_clients(isolated_db_path: Path) -> None:
    first_client = TestClient(app)
    login(first_client)

    board = first_client.get("/api/board").json()["board"]
    board["columns"][0]["title"] = "Persistent Title"
    update_response = first_client.put("/api/board", json=board)
    assert update_response.status_code == 200

    second_client = TestClient(app)
    login(second_client)
    persisted_response = second_client.get("/api/board")
    assert persisted_response.status_code == 200
    assert persisted_response.json()["board"]["columns"][0]["title"] == "Persistent Title"


def test_chat_route_requires_authentication() -> None:
    client = TestClient(app)
    response = client.post("/api/chat", json={"message": "2+2"})
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_chat_route_returns_message_and_empty_operations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.main.request_chat_completion", lambda _: "4")

    client = TestClient(app)
    login(client)

    response = client.post("/api/chat", json={"message": "2+2"})
    assert response.status_code == 200
    assert response.json() == {"message": "4", "operations": []}


def test_chat_route_maps_missing_key_to_500(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_config_error(_: str) -> str:
        raise AIClientConfigError("OPENROUTER_API_KEY is not configured.")

    monkeypatch.setattr("app.main.request_chat_completion", raise_config_error)

    client = TestClient(app)
    login(client)

    response = client.post("/api/chat", json={"message": "2+2"})
    assert response.status_code == 500
    assert response.json() == {"detail": "OPENROUTER_API_KEY is not configured."}


def test_chat_route_maps_upstream_failure_to_502(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def raise_upstream_error(_: str) -> str:
        raise AIClientUpstreamError("OpenRouter request failed with status 401.")

    monkeypatch.setattr("app.main.request_chat_completion", raise_upstream_error)

    client = TestClient(app)
    login(client)

    response = client.post("/api/chat", json={"message": "2+2"})
    assert response.status_code == 502
    assert response.json() == {"detail": "OpenRouter request failed with status 401."}
