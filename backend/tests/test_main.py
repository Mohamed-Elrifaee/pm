from fastapi.testclient import TestClient

from app.main import app


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
    response = client.post(
        "/api/login",
        json={"username": "user", "password": "password"},
    )
    assert response.status_code == 200
    assert response.json() == {"authenticated": True, "username": "user"}
    assert "session=" in response.headers.get("set-cookie", "")

    session_response = client.get("/api/session")
    assert session_response.status_code == 200
    assert session_response.json() == {"authenticated": True, "username": "user"}


def test_login_with_invalid_credentials_returns_401() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/login",
        json={"username": "user", "password": "wrong"},
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid credentials"}


def test_logout_clears_session() -> None:
    client = TestClient(app)
    login_response = client.post(
        "/api/login",
        json={"username": "user", "password": "password"},
    )
    assert login_response.status_code == 200

    logout_response = client.post("/api/logout")
    assert logout_response.status_code == 200
    assert logout_response.json() == {"authenticated": False}

    session_response = client.get("/api/session")
    assert session_response.status_code == 200
    assert session_response.json() == {"authenticated": False, "username": None}
