import os
import logging
from collections import Counter
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware
from fastapi.staticfiles import StaticFiles
from app.ai_client import AIClientConfigError, AIClientUpstreamError, request_chat_completion
from app.board_store import BoardStoreError, get_or_create_board_for_user, save_board_for_user

app = FastAPI(title="Project Management MVP API")
logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
VALID_USERNAME = "user"
VALID_PASSWORD = "password"


class LoginRequest(BaseModel):
    username: str
    password: str


class CardPayload(BaseModel):
    id: str = Field(min_length=1)
    title: str
    details: str


class ColumnPayload(BaseModel):
    id: str = Field(min_length=1)
    title: str
    cardIds: list[str]


class BoardPayload(BaseModel):
    columns: list[ColumnPayload]
    cards: dict[str, CardPayload]


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)


app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ.get("SESSION_SECRET", "pm-mvp-dev-session-secret"),
    same_site="lax",
    https_only=False,
)


@app.get("/api/health")
def read_health() -> dict[str, str]:
    return {"status": "ok"}


def _get_authenticated_username(request: Request) -> str:
    username = request.session.get("username")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )
    return str(username)


def _validate_board_payload(payload: BoardPayload) -> None:
    column_ids = [column.id for column in payload.columns]
    duplicated_column_ids = [col_id for col_id, count in Counter(column_ids).items() if count > 1]
    if duplicated_column_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Duplicate column ids are not allowed: {duplicated_column_ids}",
        )

    card_ids_from_map = set(payload.cards.keys())
    card_ids_from_columns: list[str] = []

    for card_key, card in payload.cards.items():
        if card.id != card_key:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Card key '{card_key}' does not match card.id '{card.id}'.",
            )

    for column in payload.columns:
        card_ids_from_columns.extend(column.cardIds)

    unknown_card_ids = sorted(set(card_ids_from_columns) - card_ids_from_map)
    if unknown_card_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown card ids referenced by columns: {unknown_card_ids}",
        )

    duplicate_card_assignments = [
        card_id for card_id, count in Counter(card_ids_from_columns).items() if count > 1
    ]
    if duplicate_card_assignments:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Card ids cannot appear in multiple places: {duplicate_card_assignments}",
        )

    unassigned_cards = sorted(card_ids_from_map - set(card_ids_from_columns))
    if unassigned_cards:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Every card must belong to a column. Unassigned card ids: {unassigned_cards}",
        )


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


@app.get("/api/board")
def read_board(request: Request) -> dict[str, Any]:
    username = _get_authenticated_username(request)

    try:
        board, version = get_or_create_board_for_user(username)
    except BoardStoreError:
        logger.exception("Database operation failed while reading board.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database operation failed",
        ) from None

    return {"board": board, "version": version}


@app.put("/api/board")
def write_board(payload: BoardPayload, request: Request) -> dict[str, Any]:
    username = _get_authenticated_username(request)
    _validate_board_payload(payload)
    board = payload.model_dump()

    try:
        version = save_board_for_user(username, board)
    except BoardStoreError:
        logger.exception("Database operation failed while writing board.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database operation failed",
        ) from None

    return {"board": board, "version": version}


@app.post("/api/chat")
def chat(payload: ChatRequest, request: Request) -> dict[str, Any]:
    _get_authenticated_username(request)

    try:
        assistant_message = request_chat_completion(payload.message)
    except AIClientConfigError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from None
    except AIClientUpstreamError as error:
        logger.exception("OpenRouter request failed.")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(error),
        ) from None

    return {"message": assistant_message, "operations": []}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
