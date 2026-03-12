import copy
import json
import os
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_DATABASE_PATH = Path(__file__).resolve().parent.parent / "data" / "pm.sqlite3"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS boards (
  user_id INTEGER PRIMARY KEY,
  board_json TEXT NOT NULL CHECK (json_valid(board_json)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
"""

DEFAULT_BOARD: dict[str, Any] = {
    "columns": [
        {"id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"]},
        {"id": "col-discovery", "title": "Discovery", "cardIds": ["card-3"]},
        {
            "id": "col-progress",
            "title": "In Progress",
            "cardIds": ["card-4", "card-5"],
        },
        {"id": "col-review", "title": "Review", "cardIds": ["card-6"]},
        {"id": "col-done", "title": "Done", "cardIds": ["card-7", "card-8"]},
    ],
    "cards": {
        "card-1": {
            "id": "card-1",
            "title": "Align roadmap themes",
            "details": "Draft quarterly themes with impact statements and metrics.",
        },
        "card-2": {
            "id": "card-2",
            "title": "Gather customer signals",
            "details": "Review support tags, sales notes, and churn feedback.",
        },
        "card-3": {
            "id": "card-3",
            "title": "Prototype analytics view",
            "details": "Sketch initial dashboard layout and key drill-downs.",
        },
        "card-4": {
            "id": "card-4",
            "title": "Refine status language",
            "details": "Standardize column labels and tone across the board.",
        },
        "card-5": {
            "id": "card-5",
            "title": "Design card layout",
            "details": "Add hierarchy and spacing for scanning dense lists.",
        },
        "card-6": {
            "id": "card-6",
            "title": "QA micro-interactions",
            "details": "Verify hover, focus, and loading states.",
        },
        "card-7": {
            "id": "card-7",
            "title": "Ship marketing page",
            "details": "Final copy approved and asset pack delivered.",
        },
        "card-8": {
            "id": "card-8",
            "title": "Close onboarding sprint",
            "details": "Document release notes and share internally.",
        },
    },
}


class BoardStoreError(Exception):
    pass


class BoardVersionConflictError(BoardStoreError):
    pass


def get_database_path() -> Path:
    configured = os.environ.get("DATABASE_PATH")
    if configured:
        return Path(configured)
    return DEFAULT_DATABASE_PATH


def _open_connection() -> sqlite3.Connection:
    db_path = get_database_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON;")
    connection.executescript(SCHEMA_SQL)
    return connection


def _clone_default_board() -> dict[str, Any]:
    return copy.deepcopy(DEFAULT_BOARD)


def _serialize_board(board: dict[str, Any]) -> str:
    return json.dumps(board, ensure_ascii=True, separators=(",", ":"))


def _deserialize_board(raw: str) -> dict[str, Any]:
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise BoardStoreError("Stored board JSON is not an object.")
    return parsed


def _ensure_user(connection: sqlite3.Connection, username: str) -> int:
    row = connection.execute(
        "SELECT id FROM users WHERE username = ?",
        (username,),
    ).fetchone()

    if row:
        return int(row["id"])

    cursor = connection.execute(
        "INSERT INTO users (username) VALUES (?)",
        (username,),
    )
    return int(cursor.lastrowid)


def get_or_create_board_for_user(username: str) -> tuple[dict[str, Any], int]:
    try:
        connection = _open_connection()
    except sqlite3.Error as error:
        raise BoardStoreError("Unable to open database.") from error

    try:
        user_id = _ensure_user(connection, username)
        row = connection.execute(
            "SELECT board_json, version FROM boards WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        if row:
            board = _deserialize_board(str(row["board_json"]))
            version = int(row["version"])
            connection.commit()
            return board, version

        board = _clone_default_board()
        connection.execute(
            "INSERT INTO boards (user_id, board_json) VALUES (?, ?)",
            (user_id, _serialize_board(board)),
        )
        connection.commit()
        return board, 1
    except (sqlite3.Error, json.JSONDecodeError) as error:
        connection.rollback()
        raise BoardStoreError("Unable to read board data.") from error
    finally:
        connection.close()


def save_board_for_user(username: str, board: dict[str, Any], expected_version: int) -> int:
    try:
        connection = _open_connection()
    except sqlite3.Error as error:
        raise BoardStoreError("Unable to open database.") from error

    try:
        user_id = _ensure_user(connection, username)
        row = connection.execute(
            "SELECT version FROM boards WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        serialized_board = _serialize_board(board)

        if row is None:
            if expected_version != 0:
                raise BoardVersionConflictError(
                    f"Board version conflict. Expected version {expected_version}, current version 0."
                )
            connection.execute(
                "INSERT INTO boards (user_id, board_json, version) VALUES (?, ?, 1)",
                (user_id, serialized_board),
            )
            connection.commit()
            return 1

        current_version = int(row["version"])
        if current_version != expected_version:
            raise BoardVersionConflictError(
                f"Board version conflict. Expected version {expected_version}, current version {current_version}."
            )

        next_version = current_version + 1
        cursor = connection.execute(
            """
            UPDATE boards
            SET board_json = ?, version = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND version = ?
            """,
            (serialized_board, next_version, user_id, expected_version),
        )
        if cursor.rowcount != 1:
            raise BoardVersionConflictError(
                f"Board version conflict. Expected version {expected_version}, current version changed."
            )
        connection.commit()
        return next_version
    except BoardVersionConflictError:
        connection.rollback()
        raise
    except sqlite3.Error as error:
        connection.rollback()
        raise BoardStoreError("Unable to write board data.") from error
    finally:
        connection.close()
