import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Project Management MVP API")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
VALID_USERNAME = "user"
VALID_PASSWORD = "password"


class LoginRequest(BaseModel):
    username: str
    password: str


app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ.get("SESSION_SECRET", "pm-mvp-dev-session-secret"),
    same_site="lax",
    https_only=False,
)


@app.get("/api/health")
def read_health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/session")
def read_session(request: Request) -> dict[str, str | bool | None]:
    username = request.session.get("username")
    return {"authenticated": bool(username), "username": username}


@app.post("/api/login")
def login(payload: LoginRequest, request: Request) -> dict[str, str | bool]:
    if payload.username != VALID_USERNAME or payload.password != VALID_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    request.session["username"] = payload.username
    return {"authenticated": True, "username": payload.username}


@app.post("/api/logout")
def logout(request: Request) -> dict[str, bool]:
    request.session.clear()
    return {"authenticated": False}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
