# Backend Guide

## Scope

This directory contains the FastAPI backend for the Project Management MVP.

## Current Backend Baseline

- Runtime: Python 3.12
- Web framework: FastAPI
- ASGI server: Uvicorn
- Package manager in container: `uv`
- Entrypoint module: `app.main`
- Persistence: SQLite with users, workspaces, and one board per workspace
- Sessions: signed HTTP-only cookie storing authenticated `user_id`

## Routes

- `GET /`: serves static frontend build assets from `backend/static/`
- `GET /api/health`: returns `{ "status": "ok" }`
- `GET /api/session`: returns authentication state plus current user profile from signed session cookie
- `POST /api/signup`: creates a user account and signs the user in
- `POST /api/login`: validates email/username + password and sets session cookie
- `POST /api/logout`: clears session cookie/session state
- `GET /api/workspaces`: returns authenticated user's workspaces
- `POST /api/workspaces`: creates a workspace for the authenticated user
- `PATCH /api/workspaces/{workspace_id}`: renames a workspace
- `DELETE /api/workspaces/{workspace_id}`: deletes a workspace if another remains
- `GET /api/board?workspaceId=...`: returns the selected workspace board from SQLite
- `PUT /api/board`: validates and stores the selected workspace board in SQLite
- `POST /api/chat`: authenticated OpenRouter call using selected workspace board context + history; returns structured payload:
  - `message`: assistant reply text
  - `operations`: applied board/workspace operations (`create`, `edit`, `move`, `delete`, `create_column`, `delete_column`, `create_workspace`, `delete_workspace`)
  - `workspaces`: refreshed workspace list after AI changes
  - `selectedWorkspaceId`: active workspace after AI changes
  - `board`: updated board state
  - `version`: updated board version

## Testing

- Backend tests live in `backend/tests/`
- Current tests validate:
  - HTML root page is served
  - Health endpoint response
  - Signup/login/session/logout behavior
  - Workspace CRUD rules
  - Board auth requirements, workspace isolation, validation, and persistence behavior
  - OpenRouter client request/parse behavior and chat route error mapping
  - Structured AI parsing and operation execution (`create/edit/move/delete`)

## Notes for Future Work

- Keep API under `/api/*`.
- Keep root (`/`) owned by frontend/static serving behavior per project plan.
- Current auth is local account-based, not an external identity provider.
- Legacy single-board data is migrated into the first workspace if the old `boards` table exists.
