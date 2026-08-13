# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

React + Vite frontend for a Camunda Optimize dashboard ("Application Lifecycle Processing"). It is one half of a two-service app — this directory is `frontend/`, its sibling `../backend` is an Express server that proxies Camunda Optimize / engine-rest APIs (frontend never calls Camunda directly). The two are wired together via `../docker-compose.yml`.

## Commands

Run from this `frontend/` directory:

```
npm run dev       # start Vite dev server (default port 5173)
npm run build     # production build
npm run preview   # preview the production build
npm run lint      # oxlint (see .oxlintrc.json)
```

There is no test suite in this directory (backend has one: `../backend/test/api.test.js`, run via `npm test` in `../backend`).

To run the full stack (frontend + backend) together: `docker compose up` from the repo root (`../`). The backend needs `../backend/.env` populated with Camunda credentials (see below); the frontend needs `frontend/.env`.

## Architecture

The entire UI lives in a single component: `src/App.jsx`. There is no router and no component library — three tabs ("Dashboard", "Process Instances", "Tasklist") are toggled via local `activeTab` state, each rendering its own `<section>` inline. Expect to keep extending this one file / split it out as needed rather than finding an existing multi-file structure.

Data flow: on mount, `App.jsx` fires three parallel fetches against the backend (`VITE_API_BASE_URL`, default `http://localhost:3000`):
- `GET /api/dashboard/:dashboardId/insights?processId=...` — dashboard report cards + KPI summary (drives the Dashboard tab)
- `GET /api/process-instances?processInstanceKey=...&state=...` — Process Instances tab, client-filtered further by `processFilter`
- `GET /api/tasklist?processInstanceKey=...` — Tasklist tab; selecting a task populates `taskForm` from `task.variables`

Task completion is submitted via `POST /api/tasks/:taskId/completion` with a `{ variables }` body; on success the task is removed from local state (no refetch).

Dashboard report cards are rendered heuristically in `renderDashboardVisual()`: each report's row keys are pattern-matched (`/token|cost|amount|total|count|value/i`, `/duration|time|latency/i`, `/composition|breakdown|segment|category|type/i`) to decide whether to show metric badges, a mini bar chart, a CSS conic-gradient pie chart, or a plain row list. There's no charting library — all visuals are hand-rolled with CSS (see `src/App.css`).

### Backend contract (../backend/src/server.js)

The frontend's behavior only makes sense in light of what the backend does:
- All Camunda calls require `CAMUNDA_OPTIMIZE_BASE_URL` plus either `CAMUNDA_OPTIMIZE_TOKEN` (static) or a `CLIENT_ID`/`CLIENT_SECRET` pair (OAuth client-credentials against `CAMUNDA_OAUTH_URL`, cached until near expiry). If unconfigured, endpoints return empty results (`[]` / zeroed insights) rather than erroring — the frontend can appear to "work" with a blank dashboard when Camunda env vars are simply missing.
- `insights` is an aggregate the backend builds itself: it exports the dashboard's widget/report definitions, then fetches each report's data from `/api/public/export/report/:id/result/json` and filters rows by `processId` client-side (matching against several possible key names — `processDefinitionKey`, `processDefinitionId`, `processKey`, etc.) since Optimize's export API doesn't filter by process natively.
- `process-instances` and `tasklist` hit engine-rest (`/engine-rest/process-instance`, `/engine-rest/task`) directly with the static `CAMUNDA_TOKEN`, not the OAuth-derived token — these will silently return `[]` if only client-credentials are configured and `CAMUNDA_OPTIMIZE_TOKEN` is unset.

## Environment variables

`frontend/.env` (Vite, must be prefixed `VITE_`):
- `VITE_API_BASE_URL` — backend base URL
- `VITE_DASHBOARD_ID` — Optimize dashboard to load
- `VITE_COLLECTION_ID` — Optimize collection (used by the `/api/collection/:id/*` backend routes, not currently called from `App.jsx`)
- `VITE_PROCESS_ID` — process definition key used to filter dashboard insights
- `VITE_PROCESS_INSTANCE_KEY` — optional; scopes Process Instances/Tasklist to one instance

`../backend/.env` (see `../docker-compose.yml` for the full list): `CAMUNDA_OPTIMIZE_BASE_URL`, `CAMUNDA_OPTIMIZE_TOKEN`, `CAMUNDA_OPTIMIZE_COLLECTION_ID`, plus OAuth vars (`CAMUNDA_CLIENT_AUTH_CLIENTID`/`CAMUNDA_CLIENT_AUTH_CLIENTSECRET` or `ZEEBE_CLIENT_ID`/`ZEEBE_CLIENT_SECRET`, `CAMUNDA_OAUTH_URL`).
