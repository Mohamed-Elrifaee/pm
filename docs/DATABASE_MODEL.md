# Database Model (Part 5)

## Purpose

Define the SQLite persistence model for one Kanban board per signed-in user, stored as JSON, with support for multiple users in future phases.

This document is the implementation contract for Part 6 backend work.

## Locked MVP Decisions

- Database engine: SQLite
- Storage format: one JSON board blob per user
- Auth source: session username (currently hardcoded login `user` / `password`)
- Board cardinality: exactly one board per user
- Conflict strategy: last write wins (single-user local MVP)

## SQLite File and Initialization

- Default file path: `backend/data/pm.sqlite3`
- Parent directory must be created automatically if missing.
- DB file must be created automatically on first startup.
- `PRAGMA foreign_keys = ON` must be set for each connection.

Startup initialization contract (Part 6):

1. Open SQLite connection.
2. Ensure `backend/data/` exists.
3. Run schema DDL in a transaction (`CREATE TABLE IF NOT EXISTS ...`).
4. Seed default user row lazily (on first successful auth-backed access) if missing.
5. Seed default board row lazily when board is first read and missing.

## Schema (DDL Contract)

```sql
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
```

Notes:

- `boards.user_id` is `PRIMARY KEY` to enforce exactly one board per user.
- `board_json` remains JSON text for MVP simplicity and low migration overhead.
- `version` is reserved for future optimistic concurrency support.

## Board JSON Contract (Persistence Boundary)

Stored JSON shape:

```json
{
  "columns": [
    {
      "id": "col-backlog",
      "title": "Backlog",
      "cardIds": ["card-1", "card-2"]
    }
  ],
  "cards": {
    "card-1": {
      "id": "card-1",
      "title": "Example title",
      "details": "Example details"
    }
  }
}
```

Validation rules (server-side in Part 6):

- Root object contains `columns` (array) and `cards` (object map).
- Every column has `id`, `title`, `cardIds`.
- Every card has `id`, `title`, `details`.
- Every `cardIds[]` entry must exist in `cards`.
- Extra fields are ignored for MVP unless unsafe.

## Read/Write Behavior Contract

Read (`GET /api/board` planned for Part 6):

1. Require authenticated session.
2. Resolve user by `session.username`.
3. If user row missing, create it.
4. If board row missing, create with default board JSON and return it.
5. Return current board JSON for that user.

Write (`PUT /api/board` planned for Part 6):

1. Require authenticated session.
2. Validate payload against board JSON contract.
3. Replace `board_json` for current user (`UPDATE boards SET board_json=?, version=version+1, updated_at=CURRENT_TIMESTAMP`).
4. Return updated board JSON and version.

## Error Handling Contract

- `401 Unauthorized`: no valid session.
- `404 Not Found`: authenticated user row missing and cannot be created (unexpected path).
- `422 Unprocessable Entity`: invalid board payload structure.
- `500 Internal Server Error`: DB open/query/write failures.

Logging rules:

- Log DB failures with operation context (`read_board`, `write_board`, `init_db`).
- Do not log secrets or full session cookie values.

## Test Requirements for Part 6

Schema and init:

- Fresh directory + startup creates `backend/data/pm.sqlite3`.
- Required tables/index exist after initialization.

Roundtrip:

- Insert/read board JSON for one user returns identical data.
- Two users have isolated board rows.

Validation:

- Invalid board payload returns `422`.
- Missing session returns `401`.

## Migration Guidance (Post-MVP)

- Use `PRAGMA user_version` for schema versioning.
- Add incremental SQL migrations when moving from JSON blob to normalized tables.
- Keep backward-compatible read logic for one migration window.

## Sign-off Checkpoint

Please confirm approval of this database model before Part 6 implementation starts.
