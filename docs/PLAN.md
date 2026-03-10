# Project Plan (Execution Ready)

## Project Defaults (Locked)

- Frontend delivery: static Next.js build served by FastAPI at `/`
- Auth: hardcoded credentials (`user` / `password`) with backend-validated signed HTTP-only cookie session
- Persistence: SQLite with one board JSON blob per user (MVP shape)
- API style: minimal REST endpoints (`/api/login`, `/api/logout`, `/api/board`, `/api/chat`)
- AI response contract (high level): `message` plus `operations[]` (`create`, `edit`, `move`, `delete`)
- AGENTS scope: `pm/AGENTS.md` plus scoped AGENTS files (`pm/backend/AGENTS.md`, `pm/scripts/AGENTS.md`) are authoritative in their directories

## Part 1: Plan and Baseline Documentation

### Goal
Convert planning docs into an implementation-ready checklist and document the existing frontend baseline.

### Implementation Checklist
- [ ] Rewrite this file with a consistent per-part structure (Goal, Implementation Checklist, Tests, Success Criteria, Dependencies/Notes)
- [ ] Add `pm/frontend/AGENTS.md` describing current frontend architecture, behavior, and test setup
- [ ] Add locked defaults and canonical planned API surface for later parts
- [ ] Add explicit approval gate before Part 2 execution

### Tests
- [ ] Documentation review confirms all 10 parts exist with concrete checklists, tests, and success criteria
- [ ] `pm/frontend/AGENTS.md` content matches current frontend code and scripts

### Success Criteria
- `PLAN.md` is actionable and decision-complete for Parts 1-10
- `frontend/AGENTS.md` exists and accurately describes current frontend
- Part 1 ends with explicit "User approval required before Part 2"

### Dependencies/Notes
- Documentation-only phase; no runtime feature changes

## Part 2: Scaffolding

### Goal
Set up Dockerized FastAPI backend and cross-platform scripts, and prove end-to-end local startup with a simple static page and API call.

### Implementation Checklist
- [ ] Create backend project scaffold in `pm/backend/` using FastAPI and `uv`
- [ ] Add Dockerfile and container entrypoint to run backend
- [ ] Add start/stop scripts for Windows, macOS, Linux under `pm/scripts/`
- [ ] Implement `GET /` serving simple static "hello world" HTML for this phase
- [ ] Implement health/example API endpoint (for example `GET /api/health`)
- [ ] Ensure local startup uses root `.env` for configuration

### Tests
- [ ] Backend unit test: health/example endpoint returns `200` and expected payload
- [ ] Container smoke test: build and run container, then verify `GET /` and API endpoint
- [ ] Script smoke tests: each OS script performs start/stop flow without manual edits

### Success Criteria
- App runs locally in Docker via scripts
- `GET /` returns scaffold page and API endpoint is reachable
- Backend package/dependency management is handled by `uv` in container

### Dependencies/Notes
- Uses locked defaults; frontend integration starts in Part 3

## Part 3: Add Frontend

### Goal
Serve the existing Next.js Kanban UI from FastAPI at `/` using static build output.

### Implementation Checklist
- [ ] Configure Next.js for static export compatible with FastAPI serving
- [ ] Add frontend build step and copy/export static assets into backend-served static directory
- [ ] Replace Part 2 hello world root serving with Kanban static site
- [ ] Keep API routes available under `/api/*`
- [ ] Update scripts/docker flow to include frontend build before backend start

### Tests
- [ ] Frontend unit tests (`npm run test:unit`) pass
- [ ] Frontend e2e tests (`npm run test:e2e`) pass against served app
- [ ] Integration smoke test: `GET /` renders "Kanban Studio" and columns load

### Success Criteria
- Root URL displays existing Kanban UI from static assets
- Drag/add/delete/rename behavior from current frontend still works
- Build/start flow works consistently from scripts and Docker

### Dependencies/Notes
- Depends on Part 2 scaffolding

## Part 4: Fake User Sign-In Experience

### Goal
Require login before accessing Kanban using hardcoded credentials and allow logout.

### Implementation Checklist
- [ ] Add backend login endpoint validating `user` / `password`
- [ ] Set signed HTTP-only session cookie on successful login
- [ ] Add logout endpoint that clears session cookie
- [ ] Protect board page/API access behind authenticated session
- [ ] Add frontend login screen/flow and logout control
- [ ] Add unauthorized redirects/handling for unauthenticated users

### Tests
- [ ] Backend tests for login success/failure and cookie behavior
- [ ] Backend tests for protected route unauthorized/authorized cases
- [ ] Frontend integration/e2e tests for login gate, successful login, and logout flow

### Success Criteria
- Unauthenticated user cannot access protected board behavior
- Valid credentials create session and grant access
- Logout reliably clears session and returns user to login screen

### Dependencies/Notes
- Uses locked auth approach; no external auth providers in MVP

## Part 5: Database Modeling

### Goal
Define and document SQLite persistence model for Kanban board JSON per user, and get user sign-off.

### Implementation Checklist
- [ ] Propose concrete SQLite schema for user + board JSON persistence
- [ ] Define board JSON shape at persistence boundary
- [ ] Document migration/initialization strategy for DB creation if missing
- [ ] Document read/write rules and error handling assumptions
- [ ] Add/update docs in `pm/docs/` and request user sign-off before implementation-heavy phases

### Tests
- [ ] Schema validation test for table creation on empty database
- [ ] Data roundtrip test (write/read board JSON for a user)
- [ ] Documentation review confirms schema and flow are clear

### Success Criteria
- Schema and persistence approach documented and approved
- DB can be created from empty state without manual setup
- JSON board persistence strategy is explicit and unambiguous

### Dependencies/Notes
- Sign-off checkpoint before moving to Part 6 implementation
- Part 5 documentation source: `pm/docs/DATABASE_MODEL.md`

## Part 6: Backend API for Kanban

### Goal
Implement backend API to read and update a signed-in user's Kanban board with SQLite persistence.

### Implementation Checklist
- [ ] Implement `/api/board` read endpoint for authenticated user
- [ ] Implement `/api/board` update endpoint for authenticated user board changes
- [ ] Wire endpoints to SQLite storage and create DB if missing
- [ ] Add validation for request payload shape and required fields
- [ ] Add consistent API error responses for invalid auth/input/storage failures

### Tests
- [ ] Backend unit tests for board read/update happy paths
- [ ] Backend unit tests for invalid payload and auth failures
- [ ] Backend integration test for DB auto-create and persistence across requests

### Success Criteria
- Authenticated user can read and update their board through API
- Unauthenticated requests are rejected
- Board changes persist in SQLite across process restarts

### Dependencies/Notes
- Must align with Part 5 approved schema

## Part 7: Frontend + Backend Integration

### Goal
Move frontend board state from local in-memory to backend-backed persistent API.

### Implementation Checklist
- [ ] Replace local-only board bootstrapping with `/api/board` fetch on load
- [ ] Persist rename/add/delete/move actions through backend update API
- [ ] Add loading and error states for board fetch/update failures
- [ ] Keep UX responsive while ensuring server state is source of truth
- [ ] Ensure auth/session handling is respected in frontend API calls

### Tests
- [ ] Frontend unit tests for board data mapping and client-side action handlers
- [ ] Integration tests with mocked API error/success flows
- [ ] e2e tests proving changes persist across page reload

### Success Criteria
- Board state survives reloads and restart due to backend persistence
- Existing Kanban interactions still function from user perspective
- UI handles backend failures without silent corruption

### Dependencies/Notes
- Depends on stable Part 6 API behavior

## Part 8: AI Connectivity

### Goal
Enable backend OpenRouter connectivity and validate model invocation.

### Implementation Checklist
- [ ] Add backend AI client wrapper for OpenRouter using `.env` key
- [ ] Configure model default to `openai/gpt-oss-120b`
- [ ] Add backend route or internal test hook for connectivity check
- [ ] Implement simple test prompt (for example "2+2") and return model response safely
- [ ] Add timeout and error mapping for upstream failures

### Tests
- [ ] Unit test for AI client request construction and response parsing (mocked HTTP)
- [ ] Connectivity smoke test with real key in local environment (manual/integration)
- [ ] Negative test for missing/invalid API key handling

### Success Criteria
- Backend can successfully call OpenRouter with configured model
- Connectivity check returns valid response under expected conditions
- Missing/invalid key failures are surfaced clearly

### Dependencies/Notes
- Requires `OPENROUTER_API_KEY` in root `.env`

## Part 9: Structured AI + Kanban Operations

### Goal
Extend AI call to include board context + conversation history and return structured assistant response with optional board operations.

### Implementation Checklist
- [ ] Define backend prompt contract including board JSON and conversation history
- [ ] Define structured response schema with `message` and `operations[]`
- [ ] Add strict validation/parsing of model response before applying operations
- [ ] Implement operation executor (`create`, `edit`, `move`, `delete`) against board JSON
- [ ] Persist updated board when operations are accepted
- [ ] Return both assistant message and applied operation results to frontend

### Tests
- [ ] Unit tests for response schema validation and invalid response rejection
- [ ] Unit tests for each operation type and no-op cases
- [ ] Integration tests for chat request that updates board and persists result
- [ ] Regression tests for chat requests that return message-only responses

### Success Criteria
- Chat endpoint always returns deterministic structured payload
- Valid operations update board correctly and persist
- Invalid or unsafe structured output does not corrupt board state

### Dependencies/Notes
- Detailed wire schema can be finalized in this phase before coding

## Part 10: Sidebar AI Chat UI

### Goal
Add full AI sidebar chat experience in the frontend and apply backend-provided board operations with automatic UI refresh.

### Implementation Checklist
- [ ] Build sidebar chat UI with message history and input controls
- [ ] Connect chat UI to backend `/api/chat` endpoint
- [ ] Render assistant messages and pending/error states
- [ ] Apply returned operations to board state and refresh UI reliably
- [ ] Ensure board and chat behavior remains usable on desktop and mobile widths
- [ ] Keep visual style aligned with project color system and current design language

### Tests
- [ ] Frontend unit tests for chat panel interaction and state transitions
- [ ] Integration tests for message-only and message+operations responses
- [ ] e2e tests for full flow: login -> board -> chat -> board auto-update
- [ ] e2e test for failure handling (AI/API error does not break board UI)

### Success Criteria
- Users can chat with AI from sidebar and receive responses
- AI-triggered board operations are reflected automatically without manual refresh
- Failures are visible and recoverable without data loss

### Dependencies/Notes
- Depends on stable Part 9 structured chat contract

## Approval Gate

User approval is required at the end of Part 1 before starting implementation work for Part 2 or later.
