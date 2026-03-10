# Backend Guide

## Scope

This directory contains the FastAPI backend for the Project Management MVP.

## Current Backend Baseline (Part 2)

- Runtime: Python 3.12
- Web framework: FastAPI
- ASGI server: Uvicorn
- Package manager in container: `uv`
- Entrypoint module: `app.main`

## Routes

- `GET /`: serves static frontend build assets from `backend/static/`
- `GET /api/health`: returns `{ "status": "ok" }`
- `GET /api/session`: returns authentication state from signed session cookie
- `POST /api/login`: validates hardcoded credentials and sets session cookie
- `POST /api/logout`: clears session cookie/session state
- `GET /api/board`: returns authenticated user's board from SQLite (creates default if missing)
- `PUT /api/board`: validates and stores authenticated user's board in SQLite
- `POST /api/chat`: authenticated OpenRouter call using board context + history; returns structured payload:
  - `message`: assistant reply text
  - `operations`: applied board operations (`create`, `edit`, `move`, `delete`)
  - `board`: updated board state
  - `version`: updated board version

## Testing

- Backend tests live in `backend/tests/`
- Current tests validate:
  - HTML root page is served
  - Health endpoint response
  - Login/session/logout behavior
  - Board auth requirements, validation, and persistence behavior
  - OpenRouter client request/parse behavior and chat route error mapping
  - Structured AI parsing and operation execution (`create/edit/move/delete`)

## Notes for Future Work

- Keep API under `/api/*`.
- Keep root (`/`) owned by frontend/static serving behavior per project plan.
- Current auth credentials are fixed to `user` / `password` for MVP.
- Extend this file when auth, DB, and AI functionality are introduced.
