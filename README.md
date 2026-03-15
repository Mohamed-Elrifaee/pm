# Project Management MVP

Local project management app with a Next.js frontend, FastAPI backend, SQLite storage, and OpenRouter-powered AI chat.

## Current scope

- Account signup and login
- Multiple workspaces per user
- One Kanban board per workspace
- Drag-and-drop cards
- Rename, add, and remove columns
- AI chat that can create, edit, move, and delete cards
- AI chat that can create and delete workspaces
- AI chat that can create and delete columns

## Run

Set `.env` in the project root:

```env
OPENROUTER_API_KEY=your_key
SESSION_SECRET=your_secret
```

Start with the OS script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

```bash
bash ./scripts/start-mac.sh
```

```bash
bash ./scripts/start-linux.sh
```

App URL: `http://127.0.0.1:8000`

You can sign in with the seeded demo account `user` / `password` or create a new account in the UI.

Stop with the matching script in `scripts/`.

## Tests

Frontend:

```bash
cd frontend
npm run test:unit
```

Backend:

```bash
cd backend
uv run pytest
```

## Notes

- Frontend static build is served by FastAPI at `/`
- API routes live under `/api/*`
- SQLite database lives under `backend/data/`
- More launch details are in `launching.md`
