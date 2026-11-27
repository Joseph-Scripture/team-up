import test, { mock } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/mine
//
// The list used to be owner-only (`where: { ownerId }`), so members saw
// nothing — the screen's status filter (e.g. "Completed") matched no rows.
// It now returns owned projects plus the projects the user joined through an
// ACTIVE membership, and every row carries the caller's own membership so the
// client can tell owned from joined.
//
// Prisma and Redis are faked with node:test module mocks — no database and no
// network.
// ─────────────────────────────────────────────────────────────────────────────

const projectRows = [];

const prismaFake = {
  project: {
    findMany: async (args) => {
      prismaFake.lastArgs = args;
      return projectRows;
    },
    findUnique: async (args) => {
      prismaFake.lastUniqueArgs = args;
      return null;
    },
  },
};

mock.module("../source/lib/redis.js", { exports: { default: null } });
mock.module("../source/db/client.js", { exports: { default: prismaFake } });
mock.module("../source/services/notificationService.js", {
  exports: { createNotification: async () => {} },
});

const { getProjectsForUser, invalidateProjectsMine } = await import(
  "../source/services/projectService.js"
);

function reset() {
  projectRows.length = 0;
  prismaFake.lastArgs = null;
  prismaFake.lastUniqueArgs = null;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("getProjectsForUser matches owned projects OR active memberships", async () => {
  reset();
  const projects = await getProjectsForUser("user1");

  const where = prismaFake.lastArgs.where;
  assert.equal(where.deletedAt, null, "deleted projects stay hidden");
  assert.deepEqual(
    where.OR,
    [
      { ownerId: "user1" },
      { memberships: { some: { userId: "user1", status: "ACTIVE" } } },
    ],
    "joined projects are found through an ACTIVE membership",
  );
  assert.deepEqual(
    prismaFake.lastArgs.orderBy,
    { createdAt: "desc" },
    "newest first",
  );
  assert.ok(projects, "a list is always returned");
});

test("each row exposes myMembership instead of the raw memberships array", async () => {
  reset();
  projectRows.push(
    {
      id: "owned",
      title: "Owned project",
      ownerId: "user1",
      memberships: [
        { id: "m1", accessRole: "OWNER", status: "ACTIVE", roleId: null,
          joinedAt: "2026-01-01", endedAt: null, endReason: null,
          committedHoursPerWeek: null, awayUntil: null },
      ],
    },
    {
      id: "joined",
      title: "Joined project",
      ownerId: "someone-else",
      memberships: [
        { id: "m2", accessRole: "MEMBER", status: "ACTIVE", roleId: "role9",
          joinedAt: "2026-02-01", endedAt: null, endReason: null,
          committedHoursPerWeek: 10, awayUntil: null },
      ],
    },
    {
      id: "legacy-owner",
      title: "Owner with no membership row",
      ownerId: "user1",
      memberships: [],
    },
  );

  const projects = await getProjectsForUser("user1");

  assert.equal(projects.length, 3);

  assert.equal(projects[0].myMembership.accessRole, "OWNER");
  assert.equal(projects[1].myMembership.accessRole, "MEMBER");
  assert.equal(projects[1].myMembership.committedHoursPerWeek, 10);

  assert.equal(
    projects[2].myMembership,
    null,
    "an owner without a membership row gets null, not undefined",
  );

  for (const project of projects) {
    assert.equal(
      "memberships" in project,
      false,
      "the filtered include is renamed so no partial memberships array leaks",
    );
    assert.equal("title" in project, true, "project scalars are preserved");
  }
});

test("the caller's own membership is selected, not the whole team's", async () => {
  reset();
  await getProjectsForUser("user1");

  const membershipsInclude = prismaFake.lastArgs.include.memberships;
  assert.deepEqual(
    membershipsInclude.where,
    { userId: "user1" },
    "only the caller's row comes back",
  );
  assert.ok(membershipsInclude.select.accessRole, "accessRole drives owned/joined display");
});

test("invalidateProjectsMine is a no-op when no cache is configured", async () => {
  reset();
  await invalidateProjectsMine("proj1");

  assert.equal(
    prismaFake.lastUniqueArgs,
    null,
    "no membership lookup happens when there is nothing to invalidate",
  );
});
