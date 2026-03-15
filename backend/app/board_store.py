import copy
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_DATABASE_PATH = Path(__file__).resolve().parent.parent / "data" / "pm.sqlite3"
DEFAULT_WORKSPACE_NAME = "Main workspace"
LEGACY_DEMO_EMAIL = "user@example.com"
LEGACY_DEMO_FULL_NAME = "Demo User"
LEGACY_DEMO_PASSWORD = "password"
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1

TABLES_SQL = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  full_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  password_salt TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_boards (
  workspace_id INTEGER PRIMARY KEY,
  board_json TEXT NOT NULL CHECK (json_valid(board_json)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
"""

INDEXES_SQL = """
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase ON users(email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON workspaces(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_user_name_nocase
  ON workspaces(user_id, name COLLATE NOCASE);
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


class AuthConflictError(BoardStoreError):
    pass


class WorkspaceConflictError(BoardStoreError):
    pass


class WorkspaceNotFoundError(BoardStoreError):
    pass


class WorkspaceDeletionError(BoardStoreError):
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
    _ensure_schema(connection)
    return connection


def _ensure_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(TABLES_SQL)
    _ensure_column(connection, "users", "email", "TEXT")
    _ensure_column(connection, "users", "full_name", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(connection, "users", "password_hash", "TEXT")
    _ensure_column(connection, "users", "password_salt", "TEXT")
    _bootstrap_legacy_demo_user(connection)
    connection.executescript(INDEXES_SQL)


def _ensure_column(
    connection: sqlite3.Connection,
    table_name: str,
    column_name: str,
    definition: str,
) -> None:
    columns = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    if any(str(column["name"]) == column_name for column in columns):
        return
    connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def _bootstrap_legacy_demo_user(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        """
        SELECT id, username, email, full_name, password_hash, password_salt
        FROM users
        WHERE lower(username) = 'user'
        """,
    ).fetchone()

    if not row:
        return

    if row["password_hash"] and row["password_salt"]:
        return

    password_salt, password_hash = _hash_password(LEGACY_DEMO_PASSWORD)
    connection.execute(
        """
        UPDATE users
        SET email = COALESCE(email, ?),
            full_name = CASE
              WHEN trim(coalesce(full_name, '')) = '' THEN ?
              ELSE full_name
            END,
            password_hash = ?,
            password_salt = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            LEGACY_DEMO_EMAIL,
            LEGACY_DEMO_FULL_NAME,
            password_hash,
            password_salt,
            int(row["id"]),
        ),
    )


def _clone_default_board() -> dict[str, Any]:
    return copy.deepcopy(DEFAULT_BOARD)


def _serialize_board(board: dict[str, Any]) -> str:
    return json.dumps(board, ensure_ascii=True, separators=(",", ":"))


def _deserialize_board(raw: str) -> dict[str, Any]:
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise BoardStoreError("Stored board JSON is not an object.")
    return parsed


def _normalize_username(username: str) -> str:
    return username.strip().lower()


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _normalize_workspace_name(name: str) -> str:
    return " ".join(name.split())


def _hash_password(password: str) -> tuple[str, str]:
    salt = secrets.token_bytes(16)
    hashed = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
    )
    return salt.hex(), hashed.hex()


def _verify_password(password: str, salt_hex: str, expected_hash_hex: str) -> bool:
    try:
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False

    actual_hash = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
    ).hex()
    return hmac.compare_digest(actual_hash, expected_hash_hex)


def _row_to_user(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "username": str(row["username"]),
        "email": str(row["email"] or ""),
        "fullName": str(row["full_name"] or ""),
    }


def _row_to_workspace(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "name": str(row["name"]),
        "createdAt": str(row["created_at"]),
        "updatedAt": str(row["updated_at"]),
    }


def _get_user_row(connection: sqlite3.Connection, user_id: int) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT id, username, email, full_name, created_at, updated_at
        FROM users
        WHERE id = ?
        """,
        (user_id,),
    ).fetchone()
    if not row:
        raise BoardStoreError("User was not found.")
    return row


def _ensure_default_workspace(connection: sqlite3.Connection, user_id: int) -> None:
    existing = connection.execute(
        "SELECT id FROM workspaces WHERE user_id = ? LIMIT 1",
        (user_id,),
    ).fetchone()
    if existing:
        return

    connection.execute(
        "INSERT INTO workspaces (user_id, name) VALUES (?, ?)",
        (user_id, DEFAULT_WORKSPACE_NAME),
    )


def _get_workspace_row(
    connection: sqlite3.Connection,
    user_id: int,
    workspace_id: int,
) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT id, user_id, name, created_at, updated_at
        FROM workspaces
        WHERE id = ? AND user_id = ?
        """,
        (workspace_id, user_id),
    ).fetchone()
    if not row:
        raise WorkspaceNotFoundError("Workspace was not found.")
    return row


def _workspace_board_count(connection: sqlite3.Connection, user_id: int) -> int:
    row = connection.execute(
        """
        SELECT COUNT(*) AS total
        FROM workspace_boards wb
        INNER JOIN workspaces w ON w.id = wb.workspace_id
        WHERE w.user_id = ?
        """,
        (user_id,),
    ).fetchone()
    return int(row["total"]) if row else 0


def _legacy_boards_table_exists(connection: sqlite3.Connection) -> bool:
    row = connection.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'boards'
        """,
    ).fetchone()
    return row is not None


def _migrate_legacy_board_if_needed(
    connection: sqlite3.Connection,
    user_id: int,
    workspace_id: int,
) -> tuple[dict[str, Any], int] | None:
    if _workspace_board_count(connection, user_id) > 0:
        return None

    if not _legacy_boards_table_exists(connection):
        return None

    legacy_row = connection.execute(
        "SELECT board_json, version FROM boards WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if not legacy_row:
        return None

    board = _deserialize_board(str(legacy_row["board_json"]))
    version = int(legacy_row["version"])
    connection.execute(
        """
        INSERT OR REPLACE INTO workspace_boards (workspace_id, board_json, version)
        VALUES (?, ?, ?)
        """,
        (workspace_id, _serialize_board(board), version),
    )
    return board, version


def create_user(full_name: str, username: str, email: str, password: str) -> dict[str, Any]:
    normalized_full_name = " ".join(full_name.split())
    normalized_username = _normalize_username(username)
    normalized_email = _normalize_email(email)

    try:
        connection = _open_connection()
    except sqlite3.Error as error:
        raise BoardStoreError("Unable to open database.") from error

    try:
        existing = connection.execute(
            """
            SELECT username, email
            FROM users
            WHERE lower(username) = lower(?) OR lower(email) = lower(?)
            """,
            (normalized_username, normalized_email),
        ).fetchone()
        if existing:
            if str(existing["username"]).lower() == normalized_username:
                raise AuthConflictError("That username is already in use.")
            raise AuthConflictError("That email is already in use.")

        password_salt, password_hash = _hash_password(password)
        cursor = connection.execute(
            """
            INSERT INTO users (username, email, full_name, password_hash, password_salt)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                normalized_username,
                normalized_email,
                normalized_full_name,
                password_hash,
                password_salt,
            ),
        )
        user_id = int(cursor.lastrowid)
        connection.execute(
            "INSERT INTO workspaces (user_id, name) VALUES (?, ?)",
            (user_id, DEFAULT_WORKSPACE_NAME),
        )
        connection.commit()
        return get_user_by_id(user_id)
    except AuthConflictError:
        connection.rollback()
        raise
    except sqlite3.Error as error:
        connection.rollback()
        raise BoardStoreError("Unable to create user.") from error
    finally:
        connection.close()


def authenticate_user(identifier: str, password: str) -> dict[str, Any] | None:
    normalized_identifier = identifier.strip().lower()

    try:
        connection = _open_connection()
    except sqlite3.Error as error:
        raise BoardStoreError("Unable to open database.") from error

    try:
        row = connection.execute(
            """
            SELECT id, username, email, full_name, password_hash, password_salt
            FROM users
            WHERE lower(username) = ? OR lower(email) = ?
            LIMIT 1
            """,
            (normalized_identifier, normalized_identifier),
        ).fetchone()
        if not row:
            return None

        password_hash = str(row["password_hash"] or "")
        password_salt = str(row["password_salt"] or "")
        if not password_hash or not password_salt:
            return None

        if not _verify_password(password, password_salt, password_hash):
            return None

        return _row_to_user(row)
    except sqlite3.Error as error:
        raise BoardStoreError("Unable to read user.") from error
    finally:
        connection.close()


def get_user_by_id(user_id: int) -> dict[str, Any]:
    try:
        connection = _open_connection()
    except sqlite3.Error as error:
        raise BoardStoreError("Unable to open database.") from error

    try:
        row = _get_user_row(connection, user_id)
        connection.commit()
        return _row_to_user(row)
    except sqlite3.Error as error:
        connection.rollback()
        raise BoardStoreError("Unable to read user.") from error
    finally:
        connection.close()


def list_workspaces_for_user(user_id: int) -> list[dict[str, Any]]:
    try:
        connection = _open_connection()
    except sqlite3.Error as error:
        raise BoardStoreError("Unable to open database.") from error

    try:
        _get_user_row(connection, user_id)
        _ensure_default_workspace(connection, user_id)
        rows = connection.execute(
            """
            SELECT id, name, created_at, updated_at
            FROM workspaces
            WHERE user_id = ?
            ORDER BY id ASC
            """,
            (user_id,),
        ).fetchall()
        connection.commit()
        return [_row_to_workspace(row) for row in rows]
    except sqlite3.Error as error:
        connection.rollback()
        raise BoardStoreError("Unable to read workspaces.") from error
    finally:
        connection.close()


def create_workspace_for_user(user_id: int, name: str) -> dict[str, Any]:
    normalized_name = _normalize_workspace_name(name)

    try:
        connection = _open_connection()
    except sqlite3.Error as error:
        raise BoardStoreError("Unable to open database.") from error

    try:
        _get_user_row(connection, user_id)
        existing = connection.execute(
            """
            SELECT id
            FROM workspaces
            WHERE user_id = ? AND lower(name) = lower(?)
            """,
            (user_id, normalized_name),
        ).fetchone()
        if existing:
            raise WorkspaceConflictError("A workspace with that name already exists.")

        cursor = connection.execute(
            "INSERT INTO workspaces (user_id, name) VALUES (?, ?)",
            (user_id, normalized_name),
        )
        workspace_id = int(cursor.lastrowid)
        row = _get_workspace_row(connection, user_id, workspace_id)
        connection.commit()
        return _row_to_workspace(row)
    except WorkspaceConflictError:
        connection.rollback()
        raise
    except sqlite3.Error as error:
        connection.rollback()
        raise BoardStoreError("Unable to create workspace.") from error
    finally:
        connection.close()


def rename_workspace_for_user(user_id: int, workspace_id: int, name: str) -> dict[str, Any]:
    normalized_name = _normalize_workspace_name(name)

    try:
        connection = _open_connection()
    except sqlite3.Error as error:
        raise BoardStoreError("Unable to open database.") from error

    try:
        _get_workspace_row(connection, user_id, workspace_id)
        existing = connection.execute(
            """
            SELECT id
            FROM workspaces
            WHERE user_id = ? AND lower(name) = lower(?) AND id != ?
            """,
            (user_id, normalized_name, workspace_id),
        ).fetchone()
        if existing:
            raise WorkspaceConflictError("A workspace with that name already exists.")

        connection.execute(
            """
            UPDATE workspaces
            SET name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (normalized_name, workspace_id, user_id),
        )
        row = _get_workspace_row(connection, user_id, workspace_id)
        connection.commit()
        return _row_to_workspace(row)
    except (WorkspaceConflictError, WorkspaceNotFoundError):
        connection.rollback()
        raise
    except sqlite3.Error as error:
        connection.rollback()
        raise BoardStoreError("Unable to rename workspace.") from error
    finally:
        connection.close()


def delete_workspace_for_user(user_id: int, workspace_id: int) -> tuple[list[dict[str, Any]], int]:
    try:
        connection = _open_connection()
    except sqlite3.Error as error:
        raise BoardStoreError("Unable to open database.") from error

    try:
        _get_workspace_row(connection, user_id, workspace_id)
        count_row = connection.execute(
            "SELECT COUNT(*) AS total FROM workspaces WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if not count_row or int(count_row["total"]) <= 1:
            raise WorkspaceDeletionError("At least one workspace must remain.")

        connection.execute(
            "DELETE FROM workspaces WHERE id = ? AND user_id = ?",
            (workspace_id, user_id),
        )
        rows = connection.execute(
            """
            SELECT id, name, created_at, updated_at
            FROM workspaces
            WHERE user_id = ?
            ORDER BY id ASC
            """,
            (user_id,),
        ).fetchall()
        connection.commit()
        workspaces = [_row_to_workspace(row) for row in rows]
        if not workspaces:
            raise WorkspaceDeletionError("At least one workspace must remain.")
        return workspaces, int(workspaces[0]["id"])
    except (WorkspaceDeletionError, WorkspaceNotFoundError):
        connection.rollback()
        raise
    except sqlite3.Error as error:
        connection.rollback()
        raise BoardStoreError("Unable to delete workspace.") from error
    finally:
        connection.close()


def get_or_create_board_for_workspace(user_id: int, workspace_id: int) -> tuple[dict[str, Any], int]:
    try:
        connection = _open_connection()
    except sqlite3.Error as error:
        raise BoardStoreError("Unable to open database.") from error

    try:
        _get_workspace_row(connection, user_id, workspace_id)
        row = connection.execute(
            """
            SELECT board_json, version
            FROM workspace_boards
            WHERE workspace_id = ?
            """,
            (workspace_id,),
        ).fetchone()

        if row:
            board = _deserialize_board(str(row["board_json"]))
            version = int(row["version"])
            connection.commit()
            return board, version

        migrated = _migrate_legacy_board_if_needed(connection, user_id, workspace_id)
        if migrated is not None:
            connection.commit()
            return migrated

        board = _clone_default_board()
        connection.execute(
            """
            INSERT INTO workspace_boards (workspace_id, board_json, version)
            VALUES (?, ?, 1)
            """,
            (workspace_id, _serialize_board(board)),
        )
        connection.commit()
        return board, 1
    except (WorkspaceNotFoundError, BoardStoreError):
        connection.rollback()
        raise
    except (sqlite3.Error, json.JSONDecodeError) as error:
        connection.rollback()
        raise BoardStoreError("Unable to read board data.") from error
    finally:
        connection.close()


def save_board_for_workspace(
    user_id: int,
    workspace_id: int,
    board: dict[str, Any],
    expected_version: int,
) -> int:
    try:
        connection = _open_connection()
    except sqlite3.Error as error:
        raise BoardStoreError("Unable to open database.") from error

    try:
        _get_workspace_row(connection, user_id, workspace_id)
        _migrate_legacy_board_if_needed(connection, user_id, workspace_id)
        row = connection.execute(
            """
            SELECT version
            FROM workspace_boards
            WHERE workspace_id = ?
            """,
            (workspace_id,),
        ).fetchone()

        serialized_board = _serialize_board(board)

        if row is None:
            if expected_version != 0:
                raise BoardVersionConflictError(
                    f"Board version conflict. Expected version {expected_version}, current version 0."
                )
            connection.execute(
                """
                INSERT INTO workspace_boards (workspace_id, board_json, version)
                VALUES (?, ?, 1)
                """,
                (workspace_id, serialized_board),
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
            UPDATE workspace_boards
            SET board_json = ?, version = ?, updated_at = CURRENT_TIMESTAMP
            WHERE workspace_id = ? AND version = ?
            """,
            (serialized_board, next_version, workspace_id, expected_version),
        )
        if cursor.rowcount != 1:
            raise BoardVersionConflictError(
                f"Board version conflict. Expected version {expected_version}, current version changed."
            )
        connection.commit()
        return next_version
    except (BoardVersionConflictError, WorkspaceNotFoundError):
        connection.rollback()
        raise
    except sqlite3.Error as error:
        connection.rollback()
        raise BoardStoreError("Unable to write board data.") from error
    finally:
        connection.close()
