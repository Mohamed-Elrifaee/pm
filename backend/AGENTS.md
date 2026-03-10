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

## Testing

- Backend tests live in `backend/tests/`
- Current tests validate:
  - HTML root page is served
  - Health endpoint response

## Notes for Future Work

- Keep API under `/api/*`.
- Keep root (`/`) owned by frontend/static serving behavior per project plan.
- Extend this file when auth, DB, and AI functionality are introduced.
