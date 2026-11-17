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
| Node.js   | 22.18+ or newer (24 tested)   | `node -v` — the Prisma client is imported as `.ts` and needs built-in type stripping |
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

### Create a sample project through the wizard

After signing in, use the returned access token to run a complete project
creation flow. The example resolves real skill IDs from the seeded catalogue,
creates a complete draft, and then publishes it. It creates a real project owned
by the account represented by the token.

```bash
API_BASE_URL=http://localhost:4000 ACCESS_TOKEN='<access-token>' \
  node examples/create-mock-project.mjs
```

The payload in `examples/create-mock-project.mjs` follows the API's four steps:
project basics and skills, roles and role skills, commitment, then milestones.
The same complete payload is sent to `POST /api/projects/:id/publish` because
the publish endpoint validates the wizard fields before changing the draft to
`OPEN`.

---

## Environment variables

Copy `.env.example` to `.env`. `.env` is gitignored — **never commit it**.

| Variable                | Required | Default     | Description |
| ----------------------- | -------- | ----------- | ----------- |
| `DATABASE_URL`          | **yes**  | —           | PostgreSQL connection string used by both Prisma (`prisma.config.js`) and the app (`source/db/client.js`).<br>Example: `postgresql://user:password@localhost:5432/teamup?sslmode=require` |
| `JWT_SECRET`            | **yes**  | —           | Secret used to sign/verify access tokens (HS256). **Must be at least 32 characters** — the app refuses to boot otherwise.<br>Generate one with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CLOUDINARY_URL`        | **yes**  | —           | Cloudinary credentials in the form `cloudinary://api_key:api_secret@cloud_name`. Required by `POST /api/uploads`; the app refuses to boot if it is missing or malformed. |
| `PORT`                  | no       | `4000`      | HTTP port the server listens on. |
| `NODE_ENV`              | no       | `development`| Set to `production` in deployment. |
| `ACCESS_TOKEN_TTL`      | no       | `15m`       | Access-token lifetime, in `jsonwebtoken` duration format (`30m`, `12h`, `7d`). |
| `REFRESH_TOKEN_TTL_DAYS`| no       | `30`        | Sliding lifetime of the refresh token, in days. |
| `UPLOAD_RATE_LIMIT_MAX` | no       | `20` prod / `100` dev | Maximum uploads per authenticated user per hour. |
| `SEND_LIBERTY`          | for reset emails | — | SendLiberty API key used to deliver password-reset emails. |
| `EMAIL_FROM`            | for reset emails | — | Sender shown in reset emails, e.g. `"TeamUP <no-reply@example.com>"`. Must be allowed by SendLiberty. |
| `EMAIL_REPLY_TO`        | no       | —           | Optional Reply-To address for reset emails. |
| `SEND_LIBERTY_URL`      | no       | `https://sendliberty.com/api/send` | Endpoint override, useful for tests/stubs. |
| `TEAM_HEALTH_INACTIVITY_DAYS` | no | `14` | Days without activity before a member is flagged inactive in team health. |
| `TEAM_HEALTH_CHECK_IN_INTERVAL_DAYS` | no | `7` | Weekly check-in window used by the missed-check-in signal. |
| `TEAM_HEALTH_REVIEW_STALE_DAYS` | no | `3` | Days an `IN_REVIEW` task may sit before it counts as stuck. |

Notes:

- `JWT_SECRET`, `CLOUDINARY_URL`, and `UPLOAD_RATE_LIMIT_MAX` are validated at
  startup in `config.js`; a missing or invalid value crashes the server
  immediately with a clear message.
- Password-reset emails are delivered over HTTPS through SendLiberty instead of
  SMTP. Without `SEND_LIBERTY` and `EMAIL_FROM`, the forgot-password endpoint
  still returns 202 (to avoid account enumeration) but logs a delivery error and
  sends nothing.
- `DATABASE_URL` is also read by the Prisma CLI (see `prisma.config.js`), so it
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
| `npm test`              | Run the unit tests with Node's built-in test runner (no DB/Cloudinary needed). |
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
├── config.js                 # Central env reading + validation (JWT_SECRET, CLOUDINARY_URL, PORT, TTLs)
├── prisma.config.js          # Prisma 7 config (schema path, migrations, seed, datasource)
├── source/
│   ├── db/client.js          # Prisma client instance
│   ├── routes/               # authRoutes, profileRoutes, uploadRoutes
│   ├── controllers/          # Request handlers
│   ├── services/             # Business logic (auth, sessions, profile, skills, uploads)
│   └── middleware/           # authenticate, validation, multer, rate limiting
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

| Method | Path      | Auth | Description |
| ------ | --------- | ---- | ----------- |
| GET    | `/`       | —    | Welcome message. |
| GET    | `/health` | —    | Health check. |

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
| GET    | `/skills/categories`          | —      | Distinct, sorted skill-category names. |
| GET    | `/users/me`                   | Bearer | Current user's profile. |
| PATCH  | `/users/me`                   | Bearer | Partial profile update, including `avatarUrl`. Send `avatarUrl: null` to remove the picture. |
| DELETE | `/users/me`                   | Bearer | Delete the account: soft-deletes and anonymises the user, revokes all sessions, cancels pending invitations/join requests, ends memberships, and hands owned projects over to an active manager (closing them when nobody is left). |
| PUT    | `/users/me/onboarding`        | Bearer | Save onboarding: headline, bio, links, goals, availability, preferred project duration, skills, optional avatar. |
| GET    | `/users/me/visibility`        | Bearer | Visibility settings of the current user. |
| PATCH  | `/users/me/visibility`        | Bearer | Update visibility settings (see below). |
| GET    | `/users/:userId`              | Bearer | Public profile of another user. **404** when that user turned off "Display on my profile" and you are not on their team. |
| GET    | `/users/:userId/completed-projects` | Bearer | Completed projects of another user. |

#### Visibility flags (`PATCH /api/profile/users/me/visibility`)

| Flag | Effect |
| ---- | ------ |
| `showProfile` | **Master switch** ("Display on my profile"). When `false` the public profile is hidden from visitors — they get `404`. People who already share a team with you still see you, so the workspace keeps working. |
| `shareContactWithTeam` | When `false`, teammates cannot read your contact details (email / links / location). Default `true`. |
| `showName`, `showHeadline`, `showSkills`, `showSkillLevels`, `showGoals`, `showAvailability`, `showPreferredDuration` | Hide a single field on the public profile. |

#### Contact details

`GET /api/projects/:projectId/members/:memberId/contact` returns a teammate's
email, links and location. It is readable **only by ACTIVE members of that
project** — visitors, pending invitees and everybody else get `403`, and a
member who set `shareContactWithTeam: false` is never exposed.

### Projects — `/api/projects`

| Method | Path                                   | Auth   | Description |
| ------ | -------------------------------------- | ------ | ----------- |
| GET    | `/`                                    | Bearer | Browse / search published projects. |
| POST   | `/`                                    | Bearer | Create a project draft. |
| GET    | `/mine`                                | Bearer | The current user's drafts + published projects. |
| GET    | `/recommended`                         | Bearer | Ranked project recommendations. |
| GET    | `/:id`                                 | Bearer | A single project (carries `teamHealth` for team members). |
| PUT    | `/:id`                                 | Bearer | Update a draft. |
| DELETE | `/:id`                                 | Bearer | Soft-delete a project. |
| POST   | `/:id/publish`                         | Bearer | Publish a draft (DRAFT → OPEN). Publishing also shares the project page. |
| POST   | `/:id/share`                           | Bearer | Share the project page — visible to everyone, listed in Discover. |
| POST   | `/:id/unshare`                         | Bearer | Make the project page private to the team (owner + active members). |
| POST   | `/:id/complete`                        | Bearer | Complete the project — **owner only**. See the completion rules below. |
| GET    | `/:projectId/health`                   | Bearer | Team health of a project (team members only). |
| GET    | `/:projectId/collaborators`            | Bearer | Eligible collaborators for a role. |

#### Project sharing

The project page is **private to the team** (owner + active members) until the
project is shared. Publishing a draft shares it automatically — that is what
makes a project discoverable and joinable — and the owner can unshare it again
at any time. An unshared project is invisible in Discover and in the
recommendations, and its page returns `404` for everybody outside the team.

#### Completing a project (`POST /api/projects/:id/complete`)

Only the project owner can complete a project. The server validates every
requirement — nothing can be skipped:

1. the project must be `OPEN` or `IN_PROGRESS`,
2. the owner must send a final `outcome`,
3. the project must have at least one **deliverable**,
4. **every active member** must have at least one `CONFIRMED` contribution
   (the member reviews their own summary, a teammate confirms it),
5. no contribution may still be waiting for a review,
6. no task may still be open.

When a requirement is not met the response is `409` with a `checks` array:

```json
{
  "message": "The project is not ready to be completed yet",
  "checks": [
    { "code": "NO_DELIVERABLES", "message": "Add at least one deliverable before completing the project." },
    { "code": "UNCONFIRMED_CONTRIBUTIONS", "message": "Every member needs a confirmed contribution…", "members": [{ "id": "…", "name": "…" }] }
  ]
}
```

On success the project becomes `COMPLETED`, `completedAt` and
`completionOutcome` are set, an activity-log entry is written, every member
(except the owner) gets a `PROJECT_COMPLETED` notification, and the caches are
invalidated.

### Project members, tasks and team — `/api/projects/:projectId`

| Method | Path                                | Auth   | Description |
| ------ | ----------------------------------- | ------ | ----------- |
| GET    | `/milestones`                       | Bearer | List milestones. |
| POST   | `/milestones`                       | Bearer | Create a milestone. |
| PATCH  | `/milestones/:milestoneId`          | Bearer | Update a milestone. |
| DELETE | `/milestones/:milestoneId`          | Bearer | Delete a milestone. |
| GET    | `/tasks`                            | Bearer | List tasks. |
| POST   | `/tasks`                            | Bearer | Create a task. |
| GET    | `/tasks/:taskId`                    | Bearer | A single task. |
| PATCH  | `/tasks/:taskId`                    | Bearer | Update a task. Setting `status: "COMPLETED"` may include a `contribution` block that creates the contribution. |
| DELETE | `/tasks/:taskId`                    | Bearer | Delete a task (linked contributions are preserved and unlinked). |
| GET    | `/tasks/:taskId/comments`           | Bearer | List task comments. |
| POST   | `/tasks/:taskId/comments`           | Bearer | Add a comment. |
| PATCH  | `/tasks/:taskId/comments/:commentId` | Bearer | Edit a comment. |
| DELETE | `/tasks/:taskId/comments/:commentId` | Bearer | Delete a comment. |
| GET    | `/updates`                          | Bearer | Team updates feed. |
| POST   | `/updates`                          | Bearer | Post a team update. |
| GET    | `/members`                          | Bearer | List active members. |
| POST   | `/members/leave`                    | Bearer | Leave the project voluntarily. |
| POST   | `/members/:memberId/release`        | Bearer | Owner/manager releases a member. |
| GET    | `/members/:memberId/contact`        | Bearer | A teammate's contact details — active members of that project only. |

### Contributions — `/api/projects/:projectId/contributions`

Confirmation takes **two steps**: the member reviews their own summary first,
then a teammate confirms it.

| Method | Path                      | Auth   | Description |
| ------ | ------------------------- | ------ | ----------- |
| GET    | `/`                       | Bearer | List contributions. Query: `status`, `mine=true` (only yours), `page`, `limit`. |
| POST   | `/`                       | Bearer | Submit **your own** contribution summary. |
| GET    | `/summary`                | Bearer | Confirmed contributions only — used for the project-page summary. |
| GET    | `/:contributionId`        | Bearer | A single contribution with its full review history. |
| POST   | `/:contributionId/acknowledge` | Bearer | Review and acknowledge **your own** summary (step 2). |
| POST   | `/:contributionId/review` | Bearer | Confirm or request changes (step 3). |

Rules:

- A contribution starts as `PENDING_REVIEW` with `memberAcknowledgedAt: null`.
- Only the contributor can acknowledge their own summary (`403` otherwise);
  acknowledging twice is harmless.
- `CONFIRMED` is rejected with `409` while the summary is not acknowledged.
- Only the **owner or a manager** can confirm (`403` for a plain member).
- No self-review (`403`) — the one exception is a project with a single active
  member, where the owner may confirm their own summary.
- `CHANGES_REQUESTED` puts the contribution back into `PENDING_REVIEW` and
  clears the acknowledgement, so the contributor reviews the revised summary
  again. The decision stays in the append-only review history.

### Deliverables — `/api/projects/:projectId/evidence`

| Method | Path                      | Auth   | Description |
| ------ | ------------------------- | ------ | ----------- |
| GET    | `/`                       | Bearer | List the deliverables (any active member). |
| POST   | `/`                       | Bearer | Add a deliverable — owner / manager only. Notifies the rest of the team. |
| PATCH  | `/:evidenceId`            | Bearer | Update a deliverable (patch semantics) — owner / manager only. |
| DELETE | `/:evidenceId`            | Bearer | Remove a deliverable — owner / manager only. |

A deliverable is `{ title, description?, url, type }` where `type` is one of
`REPOSITORY`, `LIVE_DEMO`, `DOCUMENT`, `IMAGE`, `VIDEO`, `OTHER`. Every
deliverable carries `createdAt` and `updatedAt`. `PATCH` and `PUT` on
`/:evidenceId` are equivalent — only the fields you send are written.

### Team health

**One status for the whole team** — never a score for an individual.

| Status | When |
| ------ | ---- |
| `ON_TRACK` | Nothing is wrong. |
| `NEEDS_ATTENTION` | An overdue task, a blocked task, a task stuck in review for more than 3 days, or a missed weekly check-in (nobody replied in the updates thread for 7 days). |
| `AT_RISK` | A milestone is overdue, or a member has been inactive for more than 14 days. |

When more than one condition applies the most serious one wins
(`AT_RISK` > `NEEDS_ATTENTION` > `ON_TRACK`). Members who marked themselves as
away (`awayUntil` in the future) are never flagged as inactive, and a
one-person project is never flagged for a missed check-in.

It is returned by `GET /api/projects/:projectId/health` and is embedded as
`teamHealth` in the project detail, in `GET /api/projects/mine` and on every
card of `GET /api/dashboard`. Only team members can read it — everybody else
gets `404` (the endpoint deliberately does not reveal that the project exists).

The thresholds can be tuned per deployment without a code change:

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `TEAM_HEALTH_INACTIVITY_DAYS` | `14` | Days without activity before a member is flagged inactive. |
| `TEAM_HEALTH_CHECK_IN_INTERVAL_DAYS` | `7` | Weekly check-in window. |
| `TEAM_HEALTH_REVIEW_STALE_DAYS` | `3` | Days an `IN_REVIEW` task may sit before it counts as stuck. |

### Task handover

| Method | Path                                          | Auth   | Description |
| ------ | --------------------------------------------- | ------ | ----------- |
| POST   | `/api/projects/:projectId/tasks/:taskId/handover-request` | Bearer | The current owner of the task asks for a handover. **Only sends a request.** |
| GET    | `/api/projects/:projectId/handover-requests`   | Bearer | List the handover requests — owner and managers. |
| POST   | `/api/projects/:projectId/handover-requests/:requestId/accept`  | Bearer | **Owner only.** Accept and name the new owner — accepting *is* the reassignment. |
| POST   | `/api/projects/:projectId/handover-requests/:requestId/decline` | Bearer | Owner or manager declines — the task keeps its owner. |
| POST   | `/api/projects/:projectId/handover-requests/:requestId/cancel`  | Bearer | The requester withdraws their own request. |

The request itself **never changes the task owner**. Only the project owner
does, either through `accept` (which reassigns in the same transaction) or by
reassigning the task manually (`PATCH /tasks/:taskId` with `assigneeMemberId`);
both resolve the pending request as `ACCEPTED`. Changing who owns a task is
therefore **owner-only** — managers can read and decline requests, and can
still edit every other task field, but they cannot transfer ownership.

Pending requests are cancelled automatically when the requesting member leaves
or is released from the project, so the owner never has to action a request
from somebody who is no longer on the team.

### Invitations, join requests and date extensions

| Method | Path                                            | Auth   | Description |
| ------ | ----------------------------------------------- | ------ | ----------- |
| POST   | `/api/projects/:projectId/invitations`          | Bearer | Send an invitation. |
| GET    | `/api/projects/:projectId/invitations`          | Bearer | Invitations sent for a project. |
| GET    | `/api/invitations`                              | Bearer | Invitations received by the current user. |
| POST   | `/api/invitations/:invitationId/accept`        | Bearer | Accept an invitation. |
| POST   | `/api/invitations/:invitationId/decline`        | Bearer | Decline an invitation. |
| POST   | `/api/projects/:projectId/join-requests`        | Bearer | Send a join request. |
| GET    | `/api/projects/:projectId/join-requests`        | Bearer | Join requests for a project (owner/manager). |
| GET    | `/api/projects/:projectId/join-requests/:requestId` | Bearer | One join request. |
| POST   | `/api/projects/:projectId/join-requests/:requestId/approve` | Bearer | Approve a request. |
| POST   | `/api/projects/:projectId/join-requests/:requestId/decline` | Bearer | Decline a request. |
| GET    | `/api/join-requests`                           | Bearer | Requests sent by the current user. |
| POST   | `/api/join-requests/:requestId/withdraw`       | Bearer | Withdraw a request. |
| POST   | `/api/join-requests/:requestId/confirm`        | Bearer | Confirm commitment after approval (creates the membership). |
| POST   | `/api/projects/:projectId/date-extension-requests` | Bearer | Request a new deadline. |
| GET    | `/api/projects/:projectId/date-extension-requests` | Bearer | Deadline requests for a project. |
| GET    | `/api/projects/:projectId/date-extension-requests/:requestId` | Bearer | One deadline request. |
| PATCH  | `/api/projects/:projectId/date-extension-requests/:requestId` | Bearer | Accept / decline / withdraw a deadline request. |
| GET    | `/api/date-extension-requests`                 | Bearer | Requests sent by the current user. |

### Dashboard and notifications

| Method | Path                                        | Auth   | Description |
| ------ | ------------------------------------------- | ------ | ----------- |
| GET    | `/api/dashboard`                            | Bearer | Dashboard summary. |
| GET    | `/api/notifications`                        | Bearer | Notifications (unread by default; `?unreadOnly=false` for all). |
| PATCH  | `/api/notifications/read-all`               | Bearer | Mark every notification as read. |
| PATCH  | `/api/notifications/:notificationId/read`    | Bearer | Mark one notification as read. |
| GET    | `/api/notifications/preferences`            | Bearer | Notification preference matrix. |
| PUT    | `/api/notifications/preferences`            | Bearer | Upsert notification preferences. |

### Uploads — `/api/uploads`

| Method | Path            | Auth   | Description |
| ------ | --------------- | ------ | ----------- |
| POST   | `/api/uploads`  | Bearer | Multipart upload. Send `context` as a query parameter (`?context=avatar`, `evidence`, or `contribution`) and the file in the `file` field. Returns `{ fileUrl, publicId }`. |

Profile-picture flow:

```bash
# 1. Upload the image
curl -X POST "http://localhost:4000/api/uploads?context=avatar" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@avatar.png"

# 2. Save the returned fileUrl
curl -X PATCH "http://localhost:4000/api/profile/users/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"avatarUrl":"https://res.cloudinary.com/..."}'
```

Auth header for protected routes:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/profile/users/me
```

> The route handlers carry full **OpenAPI/JSDoc annotations** (`@openapi`) for
> every endpoint. Swagger UI is available at `/api/docs` and the raw OpenAPI
> JSON at `/api/docs.json`.

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
