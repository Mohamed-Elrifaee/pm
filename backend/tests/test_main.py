import importlib
import json
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.ai_client import AIClientConfigError, AIClientUpstreamError
from app.board_store import DEFAULT_BOARD


@pytest.fixture
def isolated_db_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    db_path = tmp_path / "data" / "pm.sqlite3"
    monkeypatch.setenv("DATABASE_PATH", str(db_path))
    return db_path


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, isolated_db_path: Path) -> TestClient:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.delenv("SESSION_SECRET", raising=False)

    from app.main import create_app

    return TestClient(create_app())


def signup(
    client: TestClient,
    *,
    full_name: str = "Owner User",
    username: str = "owner",
    email: str = "owner@example.com",
    password: str = "password123",
) -> dict:
    response = client.post(
        "/api/signup",
        json={
            "fullName": full_name,
            "username": username,
            "email": email,
            "password": password,
        },
    )
    assert response.status_code == 200
    return response.json()


def login(
    client: TestClient,
    *,
    identifier: str = "owner@example.com",
    password: str = "password123",
) -> None:
    response = client.post(
        "/api/login",
        json={"identifier": identifier, "password": password},
    )
    assert response.status_code == 200


def get_workspaces(client: TestClient) -> list[dict]:
    response = client.get("/api/workspaces")
    assert response.status_code == 200
    return response.json()["workspaces"]


def create_board_update_payload(client: TestClient, workspace_id: int) -> dict:
    payload = client.get("/api/board", params={"workspaceId": workspace_id}).json()
    return {
        "workspaceId": workspace_id,
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
    assert response.json() == {"authenticated": False, "user": None}


def test_signup_creates_session_and_default_workspace(client: TestClient) -> None:
    response = client.post(
        "/api/signup",
        json={
            "fullName": "Owner User",
            "username": "owner",
            "email": "owner@example.com",
            "password": "password123",
        },
    )
    assert response.status_code == 200
    assert response.json()["authenticated"] is True
    assert response.json()["user"]["username"] == "owner"
    assert "session=" in response.headers.get("set-cookie", "")

    session_response = client.get("/api/session")
    assert session_response.status_code == 200
    assert session_response.json()["authenticated"] is True
    assert session_response.json()["user"]["email"] == "owner@example.com"

    workspaces = get_workspaces(client)
    assert len(workspaces) == 1
    assert workspaces[0]["name"] == "Main workspace"


def test_signup_rejects_duplicate_identity(client: TestClient) -> None:
    signup(client)
    client.post("/api/logout")

    duplicate_username = client.post(
        "/api/signup",
        json={
            "fullName": "Other User",
            "username": "owner",
            "email": "other@example.com",
            "password": "password123",
        },
    )
    assert duplicate_username.status_code == 409
    assert duplicate_username.json() == {"detail": "That username is already in use."}

    duplicate_email = client.post(
        "/api/signup",
        json={
            "fullName": "Other User",
            "username": "other",
            "email": "owner@example.com",
            "password": "password123",
        },
    )
    assert duplicate_email.status_code == 409
    assert duplicate_email.json() == {"detail": "That email is already in use."}


def test_login_accepts_email_and_username(client: TestClient) -> None:
    signup(client)
    client.post("/api/logout")

    email_response = client.post(
        "/api/login",
        json={"identifier": "owner@example.com", "password": "password123"},
    )
    assert email_response.status_code == 200
    assert email_response.json()["user"]["username"] == "owner"

    client.post("/api/logout")

    username_response = client.post(
        "/api/login",
        json={"identifier": "owner", "password": "password123"},
    )
    assert username_response.status_code == 200
    assert username_response.json()["user"]["email"] == "owner@example.com"


def test_login_with_invalid_credentials_returns_401(client: TestClient) -> None:
    signup(client)
    client.post("/api/logout")

    response = client.post(
        "/api/login",
        json={"identifier": "owner@example.com", "password": "wrong"},
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid credentials"}


def test_logout_clears_session(client: TestClient) -> None:
    signup(client)

    logout_response = client.post("/api/logout")
    assert logout_response.status_code == 200
    assert logout_response.json() == {"authenticated": False}

    session_response = client.get("/api/session")
    assert session_response.status_code == 200
    assert session_response.json() == {"authenticated": False, "user": None}


def test_workspace_routes_require_authentication(client: TestClient) -> None:
    response = client.get("/api/workspaces")
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_workspace_crud_flow(client: TestClient) -> None:
    signup(client)

    create_response = client.post("/api/workspaces", json={"name": "Client delivery"})
    assert create_response.status_code == 200
    workspace_id = create_response.json()["workspace"]["id"]
    assert create_response.json()["workspace"]["name"] == "Client delivery"

    rename_response = client.patch(
        f"/api/workspaces/{workspace_id}",
        json={"name": "Client delivery Q2"},
    )
    assert rename_response.status_code == 200
    assert rename_response.json()["workspace"]["name"] == "Client delivery Q2"

    workspaces = get_workspaces(client)
    assert [workspace["name"] for workspace in workspaces] == [
        "Main workspace",
        "Client delivery Q2",
    ]

    delete_response = client.delete(f"/api/workspaces/{workspace_id}")
    assert delete_response.status_code == 200
    assert delete_response.json()["selectedWorkspaceId"] == workspaces[0]["id"]
    assert [workspace["name"] for workspace in delete_response.json()["workspaces"]] == [
        "Main workspace"
    ]


def test_workspace_delete_rejects_removing_last_workspace(client: TestClient) -> None:
    signup(client)
    workspace_id = get_workspaces(client)[0]["id"]

    response = client.delete(f"/api/workspaces/{workspace_id}")
    assert response.status_code == 409
    assert response.json() == {"detail": "At least one workspace must remain."}


def test_workspace_routes_reject_duplicate_names(client: TestClient) -> None:
    signup(client)

    response = client.post("/api/workspaces", json={"name": "Main workspace"})
    assert response.status_code == 409
    assert response.json() == {"detail": "A workspace with that name already exists."}


def test_board_routes_require_authentication(client: TestClient) -> None:
    get_response = client.get("/api/board", params={"workspaceId": 1})
    assert get_response.status_code == 401
    assert get_response.json() == {"detail": "Unauthorized"}

    put_response = client.put(
        "/api/board",
        json={"workspaceId": 1, "board": {"columns": [], "cards": {}}, "version": 0},
    )
    assert put_response.status_code == 401
    assert put_response.json() == {"detail": "Unauthorized"}


def test_get_board_creates_database_and_returns_default_board(
    client: TestClient,
    isolated_db_path: Path,
) -> None:
    signup(client)
    workspace_id = get_workspaces(client)[0]["id"]

    response = client.get("/api/board", params={"workspaceId": workspace_id})
    assert response.status_code == 200

    payload = response.json()
    assert payload["version"] == 1
    assert len(payload["board"]["columns"]) == 5
    assert "card-1" in payload["board"]["cards"]
    assert isolated_db_path.exists()


def test_legacy_database_schema_is_migrated_on_first_request(
    client: TestClient,
    isolated_db_path: Path,
) -> None:
    isolated_db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(isolated_db_path)
    try:
        connection.executescript(
            """
            CREATE TABLE users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE boards (
              user_id INTEGER PRIMARY KEY,
              board_json TEXT NOT NULL,
              version INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        connection.execute(
            "INSERT INTO users (id, username) VALUES (?, ?)",
            (1, "user"),
        )
        connection.execute(
            "INSERT INTO boards (user_id, board_json, version) VALUES (?, ?, ?)",
            (1, json.dumps(DEFAULT_BOARD), 3),
        )
        connection.commit()
    finally:
        connection.close()

    login_response = client.post(
        "/api/login",
        json={"identifier": "user", "password": "password"},
    )
    assert login_response.status_code == 200

    workspaces_response = client.get("/api/workspaces")
    assert workspaces_response.status_code == 200
    workspaces = workspaces_response.json()["workspaces"]
    assert len(workspaces) == 1

    board_response = client.get("/api/board", params={"workspaceId": workspaces[0]["id"]})
    assert board_response.status_code == 200
    assert board_response.json()["version"] == 3
    assert board_response.json()["board"]["columns"][0]["title"] == "Backlog"


def test_put_board_updates_and_persists_board_data(client: TestClient) -> None:
    signup(client)
    workspace_id = get_workspaces(client)[0]["id"]

    update_payload = create_board_update_payload(client, workspace_id)
    update_payload["board"]["columns"][0]["title"] = "Renamed Backlog"

    update_response = client.put("/api/board", json=update_payload)
    assert update_response.status_code == 200
    assert update_response.json()["version"] == 2

    read_back = client.get("/api/board", params={"workspaceId": workspace_id})
    assert read_back.status_code == 200
    assert read_back.json()["board"]["columns"][0]["title"] == "Renamed Backlog"
    assert read_back.json()["version"] == 2


def test_workspaces_have_independent_boards(client: TestClient) -> None:
    signup(client)
    workspaces = get_workspaces(client)
    first_workspace_id = workspaces[0]["id"]
    second_workspace_id = client.post("/api/workspaces", json={"name": "Operations"}).json()[
        "workspace"
    ]["id"]

    update_payload = create_board_update_payload(client, first_workspace_id)
    update_payload["board"]["columns"][0]["title"] = "Customer backlog"
    first_update = client.put("/api/board", json=update_payload)
    assert first_update.status_code == 200

    second_board = client.get("/api/board", params={"workspaceId": second_workspace_id})
    assert second_board.status_code == 200
    assert second_board.json()["board"]["columns"][0]["title"] == "Backlog"


def test_put_board_rejects_stale_version(client: TestClient) -> None:
    signup(client)
    workspace_id = get_workspaces(client)[0]["id"]

    initial_payload = create_board_update_payload(client, workspace_id)
    initial_payload["board"]["columns"][0]["title"] = "First update"
    first_update = client.put("/api/board", json=initial_payload)
    assert first_update.status_code == 200

    stale_payload = create_board_update_payload(client, workspace_id)
    stale_payload["version"] = 1
    stale_payload["board"]["columns"][0]["title"] = "Stale update"

    stale_response = client.put("/api/board", json=stale_payload)
    assert stale_response.status_code == 409
    assert "Expected version 1, current version 2" in stale_response.json()["detail"]


def test_put_board_rejects_invalid_payload(client: TestClient) -> None:
    signup(client)
    workspace_id = get_workspaces(client)[0]["id"]

    update_payload = create_board_update_payload(client, workspace_id)
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
    signup(first_client)
    workspace_id = get_workspaces(first_client)[0]["id"]

    update_payload = create_board_update_payload(first_client, workspace_id)
    update_payload["board"]["columns"][0]["title"] = "Persistent Title"
    update_response = first_client.put("/api/board", json=update_payload)
    assert update_response.status_code == 200

    second_client = TestClient(create_app())
    login(second_client)
    persisted_response = second_client.get("/api/board", params={"workspaceId": workspace_id})
    assert persisted_response.status_code == 200
    assert persisted_response.json()["board"]["columns"][0]["title"] == "Persistent Title"


def test_chat_route_requires_authentication(client: TestClient) -> None:
    response = client.post("/api/chat", json={"workspaceId": 1, "message": "2+2"})
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_chat_route_returns_message_and_empty_operations(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.chat_service.request_chat_completion",
        lambda _: '{"message":"4","operations":[]}',
    )

    signup(client)
    workspace_id = get_workspaces(client)[0]["id"]

    response = client.post("/api/chat", json={"workspaceId": workspace_id, "message": "2+2"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["message"] == "4"
    assert payload["operations"] == []
    assert payload["workspaces"][0]["name"] == "Main workspace"
    assert payload["selectedWorkspaceId"] == workspace_id
    assert "board" in payload
    assert payload["version"] == 1


def test_chat_route_maps_missing_key_to_500(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def raise_config_error(_: str) -> str:
        raise AIClientConfigError("OPENROUTER_API_KEY is not configured.")

    monkeypatch.setattr("app.chat_service.request_chat_completion", raise_config_error)

    signup(client)
    workspace_id = get_workspaces(client)[0]["id"]

    response = client.post("/api/chat", json={"workspaceId": workspace_id, "message": "2+2"})
    assert response.status_code == 500
    assert response.json() == {"detail": "OPENROUTER_API_KEY is not configured."}


def test_chat_route_maps_upstream_failure_to_502(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def raise_upstream_error(_: str) -> str:
        raise AIClientUpstreamError("OpenRouter request failed with status 401.")

    monkeypatch.setattr("app.chat_service.request_chat_completion", raise_upstream_error)

    signup(client)
    workspace_id = get_workspaces(client)[0]["id"]

    response = client.post(
        "/api/chat",
        json={"workspaceId": workspace_id, "message": "2+2"},
    )
    assert response.status_code == 502
    assert response.json() == {"detail": "OpenRouter request failed with status 401."}


def test_chat_route_rejects_invalid_structured_response(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.chat_service.request_chat_completion", lambda _: "not json")

    signup(client)
    workspace_id = get_workspaces(client)[0]["id"]

    response = client.post(
        "/api/chat",
        json={"workspaceId": workspace_id, "message": "create a card"},
    )
    assert response.status_code == 502
    assert response.json() == {"detail": "AI response is not JSON."}


def test_chat_route_applies_operations_and_persists_board(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.chat_service.request_chat_completion",
        lambda _: (
            '{"message":"Created one card","operations":'
            '[{"type":"create","title":"AI Card","details":"from ai","columnId":"col-backlog"}]}'
        ),
    )

    signup(client)
    workspace_id = get_workspaces(client)[0]["id"]

    before = client.get("/api/board", params={"workspaceId": workspace_id}).json()
    assert before["version"] == 1

    chat_response = client.post(
        "/api/chat",
        json={"workspaceId": workspace_id, "message": "create a card in backlog"},
    )
    assert chat_response.status_code == 200
    chat_payload = chat_response.json()
    assert chat_payload["message"] == "Created one card"
    assert chat_payload["version"] == 2
    assert chat_payload["selectedWorkspaceId"] == workspace_id
    assert chat_payload["workspaces"][0]["name"] == "Main workspace"
    assert len(chat_payload["operations"]) == 1
    created_operation = chat_payload["operations"][0]
    assert created_operation["type"] == "create"

    card_id = created_operation["cardId"]
    persisted = client.get("/api/board", params={"workspaceId": workspace_id}).json()
    assert persisted["version"] == 2
    assert card_id in persisted["board"]["cards"]
    assert persisted["board"]["cards"][card_id]["title"] == "AI Card"


def test_chat_route_can_create_workspace(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.chat_service.request_chat_completion",
        lambda _: (
            '{"message":"Created workspace","operations":'
            '[{"type":"create_workspace","name":"Operations"}]}'
        ),
    )

    signup(client)
    workspace_id = get_workspaces(client)[0]["id"]

    response = client.post(
        "/api/chat",
        json={"workspaceId": workspace_id, "message": "create a workspace for operations"},
    )
    assert response.status_code == 200

    payload = response.json()
    assert payload["selectedWorkspaceId"] == workspace_id
    assert [workspace["name"] for workspace in payload["workspaces"]] == [
        "Main workspace",
        "Operations",
    ]
    assert payload["operations"] == [
        {
            "type": "create_workspace",
            "workspaceId": payload["workspaces"][1]["id"],
            "name": "Operations",
        }
    ]

    persisted_workspaces = get_workspaces(client)
    assert [workspace["name"] for workspace in persisted_workspaces] == [
        "Main workspace",
        "Operations",
    ]


def test_chat_route_can_delete_current_workspace_and_select_fallback(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.chat_service.request_chat_completion",
        lambda _: (
            '{"message":"Removed this workspace","operations":'
            '[{"type":"delete_workspace"}]}'
        ),
    )

    signup(client)
    first_workspace_id = get_workspaces(client)[0]["id"]
    second_workspace_id = client.post("/api/workspaces", json={"name": "Operations"}).json()[
        "workspace"
    ]["id"]

    response = client.post(
        "/api/chat",
        json={"workspaceId": first_workspace_id, "message": "delete this workspace"},
    )
    assert response.status_code == 200

    payload = response.json()
    assert payload["selectedWorkspaceId"] == second_workspace_id
    assert [workspace["name"] for workspace in payload["workspaces"]] == ["Operations"]
    assert payload["operations"] == [
        {
            "type": "delete_workspace",
            "workspaceId": first_workspace_id,
            "selectedWorkspaceId": second_workspace_id,
        }
    ]

    persisted_workspaces = get_workspaces(client)
    assert [workspace["id"] for workspace in persisted_workspaces] == [second_workspace_id]
