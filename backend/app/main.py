import logging
import os
import re
from collections import Counter
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, FastAPI, HTTPException, Request, status
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator
from starlette.middleware.sessions import SessionMiddleware

from app.ai_client import AIClientConfigError, AIClientUpstreamError
from app.board_store import (
    AuthConflictError,
    BoardStoreError,
    BoardVersionConflictError,
    WorkspaceConflictError,
    WorkspaceDeletionError,
    WorkspaceNotFoundError,
    authenticate_user,
    create_user,
    create_workspace_for_user,
    delete_workspace_for_user,
    get_or_create_board_for_workspace,
    get_user_by_id,
    list_workspaces_for_user,
    rename_workspace_for_user,
    save_board_for_workspace,
)
from app.chat_service import ChatOperationError, ChatResponseFormatError, process_chat_request

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
TEST_ENVIRONMENT = "test"
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
USERNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")

router = APIRouter()


class LoginRequest(BaseModel):
    identifier: str | None = None
    username: str | None = None
    password: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_identifier(self) -> "LoginRequest":
        if not (self.identifier or self.username):
            raise ValueError("identifier is required")
        return self

    @property
    def resolved_identifier(self) -> str:
        return str(self.identifier or self.username or "").strip()


class SignUpRequest(BaseModel):
    fullName: str = Field(min_length=2, max_length=80)
    username: str = Field(min_length=3, max_length=32)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("fullName")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if len(normalized) < 2:
            raise ValueError("Full name must be at least 2 characters.")
        return normalized

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not USERNAME_PATTERN.match(normalized):
            raise ValueError(
                "Username must be 3-32 characters and use lowercase letters, numbers, dots, underscores, or hyphens."
            )
        return normalized

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not EMAIL_PATTERN.match(normalized):
            raise ValueError("Enter a valid email address.")
        return normalized

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value.strip()) < 8:
            raise ValueError("Password must be at least 8 characters.")
        return value


class WorkspacePayload(BaseModel):
    name: str = Field(min_length=2, max_length=60)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if len(normalized) < 2:
            raise ValueError("Workspace name must be at least 2 characters.")
        return normalized


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


class BoardWriteRequest(BaseModel):
    workspaceId: int = Field(ge=1)
    board: BoardPayload
    version: int = Field(ge=0)


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    workspaceId: int = Field(ge=1)
    message: str = Field(min_length=1)
    history: list[ChatHistoryItem] = Field(default_factory=list, max_length=20)


def _get_session_secret() -> str:
    configured_secret = os.environ.get("SESSION_SECRET")
    if configured_secret:
        return configured_secret

    if os.environ.get("APP_ENV") == TEST_ENVIRONMENT:
        return "pm-mvp-test-session-secret"

    raise RuntimeError("SESSION_SECRET must be set before starting the application.")


def _use_secure_cookies() -> bool:
    return os.environ.get("APP_ENV", "").strip().lower() in {"production", "prod"}


def create_app() -> FastAPI:
    app = FastAPI(title="Project Management MVP API")
    app.add_middleware(
        SessionMiddleware,
        secret_key=_get_session_secret(),
        same_site="lax",
        https_only=_use_secure_cookies(),
        max_age=60 * 60 * 24 * 7,
    )
    app.include_router(router)
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
    return app


def _get_authenticated_user_id(request: Request) -> int:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )
    return int(user_id)


def _build_session_response(request: Request) -> dict[str, Any]:
    user_id = request.session.get("user_id")
    if not user_id:
        return {"authenticated": False, "user": None}

    try:
        user = get_user_by_id(int(user_id))
    except BoardStoreError:
        request.session.clear()
        return {"authenticated": False, "user": None}

    return {"authenticated": True, "user": user}


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


@router.get("/api/health")
def read_health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/api/session")
def read_session(request: Request) -> dict[str, Any]:
    return _build_session_response(request)


@router.post("/api/signup")
def signup(payload: SignUpRequest, request: Request) -> dict[str, Any]:
    try:
        user = create_user(
            full_name=payload.fullName,
            username=payload.username,
            email=payload.email,
            password=payload.password,
        )
    except AuthConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from None
    except BoardStoreError:
        logger.exception("Database operation failed while creating a user.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database operation failed",
        ) from None

    request.session["user_id"] = int(user["id"])
    return {"authenticated": True, "user": user}


@router.post("/api/login")
def login(payload: LoginRequest, request: Request) -> dict[str, Any]:
    try:
        user = authenticate_user(payload.resolved_identifier, payload.password)
    except BoardStoreError:
        logger.exception("Database operation failed while signing in.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database operation failed",
        ) from None

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    request.session["user_id"] = int(user["id"])
    return {"authenticated": True, "user": user}


@router.post("/api/logout")
def logout(request: Request) -> dict[str, bool]:
    request.session.clear()
    return {"authenticated": False}


@router.get("/api/workspaces")
def read_workspaces(request: Request) -> dict[str, Any]:
    user_id = _get_authenticated_user_id(request)

    try:
        workspaces = list_workspaces_for_user(user_id)
    except BoardStoreError:
        logger.exception("Database operation failed while reading workspaces.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database operation failed",
        ) from None

    return {"workspaces": workspaces}


@router.post("/api/workspaces")
def create_workspace(payload: WorkspacePayload, request: Request) -> dict[str, Any]:
    user_id = _get_authenticated_user_id(request)

    try:
        workspace = create_workspace_for_user(user_id, payload.name)
    except WorkspaceConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from None
    except BoardStoreError:
        logger.exception("Database operation failed while creating workspace.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database operation failed",
        ) from None

    return {"workspace": workspace}


@router.patch("/api/workspaces/{workspace_id}")
def rename_workspace(
    workspace_id: int,
    payload: WorkspacePayload,
    request: Request,
) -> dict[str, Any]:
    user_id = _get_authenticated_user_id(request)

    try:
        workspace = rename_workspace_for_user(user_id, workspace_id, payload.name)
    except WorkspaceNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from None
    except WorkspaceConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from None
    except BoardStoreError:
        logger.exception("Database operation failed while renaming workspace.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database operation failed",
        ) from None

    return {"workspace": workspace}


@router.delete("/api/workspaces/{workspace_id}")
def delete_workspace(workspace_id: int, request: Request) -> dict[str, Any]:
    user_id = _get_authenticated_user_id(request)

    try:
        workspaces, selected_workspace_id = delete_workspace_for_user(user_id, workspace_id)
    except WorkspaceNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from None
    except WorkspaceDeletionError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from None
    except BoardStoreError:
        logger.exception("Database operation failed while deleting workspace.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database operation failed",
        ) from None

    return {"workspaces": workspaces, "selectedWorkspaceId": selected_workspace_id}


@router.get("/api/board")
def read_board(workspaceId: int, request: Request) -> dict[str, Any]:
    user_id = _get_authenticated_user_id(request)

    try:
        board, version = get_or_create_board_for_workspace(user_id, workspaceId)
    except WorkspaceNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from None
    except BoardStoreError:
        logger.exception("Database operation failed while reading board.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database operation failed",
        ) from None

    return {"board": board, "version": version}


@router.put("/api/board")
def write_board(payload: BoardWriteRequest, request: Request) -> dict[str, Any]:
    user_id = _get_authenticated_user_id(request)
    _validate_board_payload(payload.board)
    board = payload.board.model_dump()

    try:
        version = save_board_for_workspace(user_id, payload.workspaceId, board, payload.version)
    except WorkspaceNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from None
    except BoardVersionConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from None
    except BoardStoreError:
        logger.exception("Database operation failed while writing board.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database operation failed",
        ) from None

    return {"board": board, "version": version}


@router.post("/api/chat")
def chat(payload: ChatRequest, request: Request) -> dict[str, Any]:
    user_id = _get_authenticated_user_id(request)

    try:
        history = [item.model_dump() for item in payload.history]
        response_payload = process_chat_request(
            user_id=user_id,
            workspace_id=payload.workspaceId,
            user_message=payload.message,
            history=history,
        )
    except WorkspaceNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from None
    except AIClientConfigError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from None
    except (AIClientUpstreamError, ChatResponseFormatError, ChatOperationError) as error:
        logger.exception("OpenRouter request failed.")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(error),
        ) from None
    except BoardStoreError:
        logger.exception("Database operation failed during chat processing.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database operation failed",
        ) from None

    return response_payload


app = create_app()
