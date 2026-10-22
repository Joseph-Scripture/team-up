# TeamUP — Backend API

> This is the repo for the backend team for the TeamUP project.

TeamUP is a REST API for team formation and project collaboration: users sign up,
complete an onboarding profile (skills, availability, links) and are matched into
projects with roles, tasks, contributions and notifications.

Built with **Node.js (ESM) + Express 5**, **Prisma ORM 7** and **PostgreSQL**.

---

## Prerequisites

| Tool      | Version                       | Notes                                        |
| --------- | ----------------------------- | -------------------------------------------- |
| Node.js   | 20 LTS or newer (24 tested)   | `node -v`                                    |
| npm       | 10+                           | ships with Node                              |
| PostgreSQL| 14+                           | the schema uses `pg_trgm`, created by migration |
| Git       | any recent                    |                                              |

You need a PostgreSQL connection string. Any of these work: a local Postgres
instance, Docker (`docker run --name teamup-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgres`),
or a hosted instance (Neon, Supabase, Railway, ...).

---

## Getting started

```bash
# 1. Clone
git clone <repo-url>
cd TeamUP

# 2. Install dependencies
npm install

# 3. Configure the environment
cp .env.example .env
# then edit .env with your real database URL and a generated JWT secret

# 4. Create the database schema
npm run migrate:dev        # applies prisma/migrations + runs the extras verification

# 5. Seed the skills catalogue (safe to re-run, it upserts)
npx prisma db seed

# 6. Start the API in watch mode (nodemon)
npm run dev                # → http://localhost:4000
```

Verify it works:

```bash
curl http://localhost:4000/
# {"message":"Welcome to the home page"}

curl http://localhost:4000/api/profile/skills
```

---

## Environment variables

Copy `.env.example` to `.env`. `.env` is gitignored — **never commit it**.

| Variable                | Required | Default     | Description |
| ----------------------- | -------- | ----------- | ----------- |
| `DATABASE_URL`          | **yes**  | —           | PostgreSQL connection string used by both Prisma (`prisma7.config.js`) and the app (`source/db/client.js`).<br>Example: `postgresql://user:password@localhost:5432/teamup?sslmode=require` |
| `JWT_SECRET`            | **yes**  | —           | Secret used to sign/verify access tokens (HS256). **Must be at least 32 characters** — the app refuses to boot otherwise.<br>Generate one with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PORT`                  | no       | `4000`      | HTTP port the server listens on. |
| `NODE_ENV`              | no       | `development`| Set to `production` in deployment. |
| `ACCESS_TOKEN_TTL`      | no       | `15m`       | Access-token lifetime, in `jsonwebtoken` duration format (`30m`, `12h`, `7d`). |
| `REFRESH_TOKEN_TTL_DAYS`| no       | `30`        | Sliding lifetime of the refresh token, in days. |

Notes:

- `JWT_SECRET` and `ACCESS_TOKEN_TTL` are validated at startup in
  `source/config.js`; a missing or short value crashes the server immediately
  with a clear message.
- `DATABASE_URL` is also read by the Prisma CLI (see `prisma7.config.js`), so it
  must be present in `.env` for migrations to work. Prisma 7 does **not** load
  `.env` by itself — the config imports `dotenv/config`, and `prisma/seed.js`
  does the same.
- Auth uses a short-lived Bearer access token plus a rotating refresh token
  stored in an **httpOnly cookie named `teamup_rt` scoped to path `/api/auth`**.

---

## Available scripts

| Script                  | What it does |
| ----------------------- | ------------ |
| `npm run dev`           | Start the API with nodemon (auto-restart on file changes). |
| `npm run migrate:dev`   | Apply pending migrations to the dev DB, then run `db:verify-extras`. |
| `npm run migrate:deploy`| Apply pending migrations (use this in production/CI), then run `db:verify-extras`. |
| `npm run db:extras`     | (Re)apply the SQL objects Prisma cannot express — partial unique indexes, CHECK constraints, GIN/trigram indexes. Idempotent, safe to run any time. |
| `npm run db:verify-extras` | Assert every one of those objects exists; exits non-zero listing anything missing. |
| `npx prisma db seed`    | Seed the skills catalogue (`prisma/seed.js`). Upserts, so it is idempotent. |
| `npx prisma studio`     | Open the browser DB GUI. |

### Database rules of thumb

- **Never run `prisma db push`** against a shared/dev database: it bypasses
  migration history and can silently strip the hardening in
  `prisma/extras/migration_extras.sql`.
- Schema changes go through migrations:
  `npx prisma migrate dev --create-only` → edit the generated SQL →
  `npx prisma migrate dev`. If you add an extra (partial index, CHECK, GIN),
  follow the procedure documented at the top of `prisma/extras/migration_extras.sql`.
- `migrate:dev` / `migrate:deploy` already run the verification step, so drift
  fails loudly instead of silently.

---

## Project structure

```
.
├── index.js                  # App entry: middleware, route mounting, listen
├── prisma7.config.js         # Prisma 7 config (schema path, migrations, seed, datasource)
├── source/
│   ├── config.js             # Central env reading + validation (JWT_SECRET, PORT, TTLs)
│   ├── db/client.js          # Prisma client instance
│   ├── routes/               # authRoutes, profileRoutes
│   ├── controllers/          # Request handlers
│   ├── services/             # Business logic (auth, sessions, profile, skills)
│   └── middleware/           # authenticate, validation
├── prisma/
│   ├── schema.prisma         # Data model (output → src/generated/prisma)
│   ├── migrations/           # Committed migration history
│   ├── extras/               # Non-PSL SQL (indexes/CHECKs) + drift verification
│   └── seed.js               # Skills catalogue seed
└── src/generated/            # Prisma client output — gitignored, regenerated by `prisma generate`
```

The Prisma client is generated into `src/generated/prisma` and is **not**
committed. `npm install` / `npm run migrate:dev` regenerate it automatically
(`@prisma/client` is generated on install via Prisma's postinstall).

---

## API overview

Base URL: `http://localhost:4000`

### General

| Method | Path  | Auth | Description |
| ------ | ----- | ---- | ----------- |
| GET    | `/`   | —    | Welcome message / health check. |

### Auth — `/api/auth`

| Method | Path            | Auth                | Description |
| ------ | --------------- | ------------------- | ----------- |
| POST   | `/signup`       | —                   | Create account; returns access token + sets refresh cookie. |
| POST   | `/login`        | —                   | Sign in; returns access token + sets refresh cookie. |
| POST   | `/refresh`      | refresh cookie      | Rotate the refresh token, returns a new access token. |
| POST   | `/logout`       | cookie or Bearer    | Revoke the current session family. |
| POST   | `/logout-all`   | Bearer              | Revoke every session of the user. |
| GET    | `/sessions`     | Bearer              | List active sessions (devices). |

### Profile — `/api/profile`

| Method | Path                          | Auth   | Description |
| ------ | ----------------------------- | ------ | ----------- |
| GET    | `/skills`                     | —      | Full skills catalogue. Optional query: `q` (partial name match) and `category`, both case-insensitive. |
| GET    | `/users/me`                   | Bearer | Current user's profile. |
| PUT    | `/users/me/onboarding`        | Bearer | Save onboarding: headline, bio, links, goals, availability, preferred project duration, skills. |

Auth header for protected routes:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/profile/users/me
```

> The route handlers carry full **OpenAPI/JSDoc annotations** (`@openapi`) for
> every endpoint, ready for a Swagger UI route to be wired up — that route does
> not exist yet.

---

## Working together

1. **Branch off `main`** with a descriptive name (`feat/...`, `fix/...`).
2. **Never commit `.env`**, secrets, or `src/generated/`. `.gitignore` already
   covers them; keep `.env.example` in sync when you add a variable.
3. **Commit `package-lock.json`** — always install with `npm install`, not
   `npm i --no-save`, so dependency versions stay reproducible.
4. **Commit migrations**, never raw `db push` results.
5. **Run before pushing:**
   ```bash
   npm run migrate:dev   # or migrate:deploy against a clean scratch DB
   npm run dev           # smoke test the endpoints you touched
   ```
6. Share a fresh `.env.example` whenever configuration changes, and put the
   real values in your team's secret manager / a pinned message — not in chat
   history or commits.
