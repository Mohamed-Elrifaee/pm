# Frontend Agent Guide

## Scope

This file defines the current frontend baseline in `pm/frontend/`. Use it as the source of truth when planning or implementing frontend changes for this project.

## Current Stack and Runtime

- Framework: Next.js (App Router) + React + TypeScript
- Styling: Tailwind CSS (v4) with global styles in `src/app/globals.css`
- Drag and drop: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
- Package manager/scripts: npm (`package.json` scripts)
- Local runtime scripts:
  - `npm run dev`
  - `npm run build`
  - `npm run start`

## Current Feature Behavior

- App entrypoint at `src/app/page.tsx` renders `AppShell`.
- `AppShell` checks `GET /api/session` and gates access to the board.
- Authentication uses backend account APIs:
  - `POST /api/signup`
  - `POST /api/login`
  - `POST /api/logout`
- Workspaces use backend API:
  - `GET /api/workspaces`
  - `POST /api/workspaces`
  - `PATCH /api/workspaces/{id}`
  - `DELETE /api/workspaces/{id}`
- Board data source is backend API scoped to the selected workspace:
  - `GET /api/board?workspaceId=...` on authenticated load
  - `PUT /api/board` after board interactions
- AI chat data source is backend API:
  - `POST /api/chat` with `workspaceId` + `message` + `history`
  - Returns `message`, `operations`, `workspaces`, `selectedWorkspaceId`, `board`, `version`
- Current UX is a multi-workspace Kanban experience with one board per workspace.
- Supported in current UI:
  - Sign up with full name, username, email, and password
  - Sign in with email or username and password
  - Create, rename, switch, and delete workspaces
  - Rename column titles inline
  - Add cards (title + optional details)
  - Delete cards
  - Move cards within and across columns with drag-and-drop
  - Chat with AI assistant in sidebar
  - Apply AI-returned card, column, and workspace operations automatically to current board/workspace list
  - Show chat errors without breaking board interactions
- Board state displayed in UI is backend-backed (SQLite via backend API) once user signs in.

## Current Data Model

Defined in `src/lib/kanban.ts`:

- `Card`
  - `id: string`
  - `title: string`
  - `details: string`
- `Column`
  - `id: string`
  - `title: string`
  - `cardIds: string[]`
- `BoardData`
  - `columns: Column[]`
  - `cards: Record<string, Card>`

Auth/session shape from the backend:

- `SessionResponse`
  - `authenticated: boolean`
  - `user: { id: number, fullName: string, username: string, email: string } | null`

Workspace shape from the backend:

- `Workspace`
  - `id: number`
  - `name: string`
  - `createdAt: string`
  - `updatedAt: string`

Utility behavior currently includes:

- `initialData` seed board content
- `moveCard(columns, activeId, overId)` for DnD reordering/moving
- `createId(prefix)` for client-side id generation

## Current Tests and Commands

- Unit/component tests (Vitest + Testing Library):
  - `npm run test`
  - `npm run test:unit`
  - `npm run test:unit:watch`
- End-to-end tests (Playwright):
  - `npm run test:e2e`
- Combined run:
  - `npm run test:all`

Current tested behaviors include:

- Login screen when unauthenticated
- Successful account creation, sign-in, and logout flow
- Workspace creation and switching
- Board persistence through backend-backed save/load
- AI chat request/response rendering and board auto-update
- Rendering board/columns
- Renaming a column
- Adding/removing cards
- Dragging cards between columns (including into empty columns) (e2e)
- Chat operation success and failure flows (e2e)

## Constraints for Future Changes

- Preserve current Kanban behavior unless a phase in `pm/docs/PLAN.md` explicitly changes it.
- Do not invent backend-auth or persistence behavior in frontend-only phases.
- Keep frontend API integration aligned with planned backend endpoints:
  - `/api/signup`
  - `/api/login`
  - `/api/logout`
  - `/api/workspaces`
  - `/api/board`
  - `/api/chat`
- If frontend architecture or behavior changes, update this file in the same change set.
