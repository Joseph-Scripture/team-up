import test, { mock } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/tasks/:taskId
//
// Regression suite for the task detail 500: `getTask` used to select a
// `contributions` relation on Task that commit e64f729 deleted from the
// schema, so Prisma threw PrismaClientValidationError and the controller
// answered 500. The task → contribution link now lives in
// ContributionEvidence.taskId and the documented `contributions[]` payload is
// rebuilt from it.
//
// Prisma and the collaborators of taskService are replaced with in-memory
// fakes via node:test module mocks — no database needed.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-11-25T12:00:00.000Z");

const state = {
  project: null,   // returned by project.findFirst (resolveAccess)
  task: null,      // returned by task.findFirst
  selects: [],     // every select passed to task.findFirst
};

function reset() {
  state.project = null;
  state.task = null;
  state.selects.length = 0;
}

const prismaFake = {
  project: {
    findFirst: async () => state.project,
  },
  task: {
    findFirst: async ({ select } = {}) => {
      state.selects.push(select ?? null);
      return state.task;
    },
  },
};

mock.module("../source/db/client.js", { exports: { default: prismaFake } });
mock.module("../source/services/notificationService.js", {
  exports: { createNotification: async () => {} },
});

const { getTask, TaskError } = await import("../source/services/taskService.js");

// ── Scenario builders ────────────────────────────────────────────────────────

function makeProject(overrides = {}) {
  return {
    id: "proj1",
    title: "Test Project",
    ownerId: "owner1",
    memberships: [{ id: "member1", accessRole: "MEMBER" }],
    ...overrides,
  };
}

function evidence(id, contributionId, extra = {}) {
  return {
    id,
    title: `Evidence ${id}`,
    url: null,
    type: "TASK_COMPLETION",
    contribution: {
      id: contributionId,
      title: `Summary ${contributionId}`,
      status: "CONFIRMED",
      submittedAt: NOW,
      ...extra.contribution,
    },
    ...extra,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("getTask never asks Prisma for the removed `contributions` relation", async () => {
  reset();
  state.project = makeProject();
  state.task = { id: "t1", contributionEvidence: [] };

  await getTask("user1", "proj1", "t1");

  const select = state.selects.at(-1);
  assert.ok(select, "task.findFirst was called with a select");
  assert.equal(
    "contributions" in select,
    false,
    "selecting `contributions` is what threw PrismaClientValidationError",
  );
  assert.equal("contributionEvidence" in select, true, "the surviving relation is selected");
  assert.ok("milestone" in select && "assignee" in select && "createdBy" in select);
});

test("getTask rebuilds contributions[] with the evidence recorded for this task", async () => {
  reset();
  state.project = makeProject();
  state.task = {
    id: "t1",
    title: "Ship the landing page",
    status: "COMPLETED",
    contributionEvidence: [
      evidence("ev1", "c1"),
      evidence("ev2", "c1", { url: "https://example.com/demo", type: "LIVE_DEMO" }),
      evidence("ev3", "c2"),
    ],
  };

  const task = await getTask("user1", "proj1", "t1");

  assert.equal(task.title, "Ship the landing page");
  assert.equal(
    "contributionEvidence" in task,
    false,
    "the raw relation is never leaked to the client",
  );

  assert.equal(task.contributions.length, 2, "one entry per contribution summary");

  const [first, second] = task.contributions;
  assert.equal(first.id, "c1");
  assert.equal(first.title, "Summary c1");
  assert.equal(first.status, "CONFIRMED");
  assert.ok(first.submittedAt, "submittedAt is kept");
  assert.deepEqual(
    first.evidence.map((e) => e.id),
    ["ev1", "ev2"],
    "both evidence rows of that summary belong to the entry",
  );
  assert.deepEqual(
    Object.keys(first.evidence[0]).sort(),
    ["id", "title", "type", "url"],
    "evidence keeps the documented shape",
  );

  assert.equal(second.id, "c2");
  assert.deepEqual(
    second.evidence.map((e) => e.id),
    ["ev3"],
    "evidence of another summary stays on its own entry",
  );
});

test("getTask returns an empty contributions array when the task has no evidence", async () => {
  reset();
  state.project = makeProject();
  state.task = { id: "t1", title: "No work yet", contributionEvidence: [] };

  const task = await getTask("user1", "proj1", "t1");

  assert.deepEqual(task.contributions, []);
  assert.equal(task.title, "No work yet");
});

test("getTask returns 404 when the task does not exist on the project", async () => {
  reset();
  state.project = makeProject();
  state.task = null;

  await assert.rejects(
    () => getTask("user1", "proj1", "missing"),
    (err) => err instanceof TaskError && err.status === 404,
  );
});

test("getTask returns 404 for callers who are not on the team", async () => {
  reset();
  state.project = makeProject({ memberships: [] }); // caller is neither owner nor member
  state.task = { id: "t1", contributionEvidence: [] };

  await assert.rejects(
    () => getTask("stranger", "proj1", "t1"),
    (err) => err instanceof TaskError && err.status === 404,
  );
});
