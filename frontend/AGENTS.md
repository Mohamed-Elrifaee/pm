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
- Login uses hardcoded credentials via backend API:
  - `POST /api/login`
  - `POST /api/logout`
- Current UX is a single-board Kanban experience with five columns.
- Supported in current UI:
  - Rename column titles inline
  - Add cards (title + optional details)
  - Delete cards
  - Move cards within and across columns with drag-and-drop
- Current board state is saved in browser `localStorage` per username (`kanban-board:<username>`), so local changes survive logout/login for the same browser user.

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
- Successful sign-in and logout flow
- Rendering board/columns
- Renaming a column
- Adding/removing cards
- Dragging cards between columns (including into empty columns) (e2e)

## Constraints for Future Changes

- Preserve current Kanban behavior unless a phase in `pm/docs/PLAN.md` explicitly changes it.
- Do not invent backend-auth or persistence behavior in frontend-only phases.
- Keep frontend API integration aligned with planned backend endpoints:
  - `/api/login`
  - `/api/logout`
  - `/api/board`
  - `/api/chat`
- If frontend architecture or behavior changes, update this file in the same change set.
