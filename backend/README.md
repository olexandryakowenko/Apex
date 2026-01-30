# Apex Backend (folder for monorepo)

## What this backend does
- `POST /api/lead` — receives lead from the site form, stores into SQLite, sends Telegram notification (if configured).
- Admin API (JWT):
  - `POST /api/admin/login`
  - `GET /api/admin/leads`
  - `GET /api/admin/leads/:id`
  - `PATCH /api/admin/leads/:id`

## Local run
1) `cd backend`
2) `cp .env.example .env` and fill values
3) `npm install`
4) `npm start`
Open:
- Health: `http://localhost:8080/api/health`

## Deploy on Render (monorepo)
- **Root Directory**: `backend`
- **Build command**: `npm install`
- **Start command**: `npm start`
- Add env vars from `.env.example`

## CORS
Allow your GitHub Pages origin:
- `CORS_ORIGIN_1=https://olexandryakowenko.github.io`
