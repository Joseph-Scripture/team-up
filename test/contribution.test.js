import test, { mock } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// Contribution service tests — one summary per member per project.
//
// The services' collaborators — Prisma and createNotification — are replaced
// with in-memory fakes via node:test module mocks, so no database is needed.
// The fake Prisma reads a mutable `state` object that every test builds
// before invoking a service; captured side effects (creates, updates,
// evidence, notifications) land in shared arrays that each test resets first.
//
// Requires: node --experimental-test-module-mocks (wired into `npm test`).
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-11-25T12:00:00.000Z");

const state = {
  project: null,            // returned by project.findFirst
  contribution: null,       // returned by contribution.findFirst / findUnique(by id)
  summaryLookup: null,      // returned by contribution.findUnique({ projectId_memberId })
  task: null,               // returned by task.findFirst (base for task.update)
  contributorMember: null,  // member shape attached to contribution.create
  managers: [],             // returned by projectMember.findMany
  updateCalls: [],          // payloads of every contribution.update
  taskUpdateCalls: [],      // payloads of every task.update
  reviewCreates: [],        // payloads of every contributionReview.create
  evidenceDeletes: [],      // args of every contributionEvidence.deleteMany
  evidenceCreates: [],      // payloads of every contributionEvidence.create / createMany
  createCalls: [],          // payloads of every contribution.create
};

const notifications = [];

function reset() {
  state.project = null;
  state.contribution = null;
  state.summaryLookup = null;
  state.task = null;
  state.contributorMember = null;
  state.managers = [];
  state.updateCalls = [];
  state.taskUpdateCalls = [];
  state.reviewCreates = [];
  state.evidenceDeletes = [];
  state.evidenceCreates = [];
  state.createCalls = [];
  notifications.length = 0;
}

// The summary a fake contribution.create "just made".
function lastCreatedSummary() {
  const created = state.createCalls[state.createCalls.length - 1];
  if (!created) return null;
  return {
    id: "contrib-new",
    title: created.title,
    status: created.status ?? "PENDING_REVIEW",
    description: created.description ?? null,
    evidence: state.evidenceCreates.map((e) => ({ id: "ev", ...e })),
  };
}

// ── Fake Prisma ──────────────────────────────────────────────────────────────

const prismaFake = {
  project: {
    findFirst: async () => state.project,
  },
  task: {
    findFirst: async () => state.task,
    update: async ({ data }) => {
      state.taskUpdateCalls.push(data);
      return { ...state.task, ...data };
    },
  },
  contribution: {
    findFirst: async () => state.contribution,
    findUnique: async ({ where } = {}) => {
      if (where?.projectId_memberId) return state.summaryLookup ?? null;
      // by id — the summary we know about, falling back to the created one
      return state.contribution ?? state.summaryLookup ?? lastCreatedSummary();
    },
    findMany: async () => [],
    count: async () => 0,
    create: async ({ data }) => {
      state.createCalls.push(data);
      // Nested evidence: { create: [...] } from submitContribution
      if (Array.isArray(data.evidence?.create)) {
        state.evidenceCreates.push(
          ...data.evidence.create.map((e) => ({ contributionId: "contrib-new", ...e })),
        );
      }
      return {
        id: "contrib-new",
        title: data.title,
        description: data.description ?? null,
        status: data.status ?? "PENDING_REVIEW",
        memberAcknowledgedAt: data.memberAcknowledgedAt ?? null,
        submittedAt: NOW,
        confirmedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        member: state.contributorMember,
        evidence: [],
        reviews: [],
      };
    },
    update: async ({ data }) => {
      state.updateCalls.push(data);
      return { ...state.contribution, ...data };
    },
  },
  contributionReview: {
    create: async ({ data }) => {
      state.reviewCreates.push(data);
      return { id: "review-new", ...data, createdAt: NOW };
    },
  },
  contributionEvidence: {
    create: async ({ data }) => {
      state.evidenceCreates.push(data);
      return { id: "ev-new", ...data };
    },
    createMany: async ({ data }) => {
      state.evidenceCreates.push(...data);
      return { count: data.length };
    },
    findFirst: async ({ where } = {}) =>
      state.evidenceCreates.find(
        (e) => e.contributionId === where.contributionId && e.taskId === where.taskId,
      ) ?? null,
    findMany: async ({ where } = {}) =>
      state.evidenceCreates
        .filter(
          (e) =>
            e.contributionId === where.contributionId &&
            (!where.url?.in || where.url.in.includes(e.url)),
        )
        .map((e) => ({ url: e.url })),
    deleteMany: async (args) => {
      state.evidenceDeletes.push(args);
      return { count: 1 };
    },
  },
  projectMember: {
    findMany: async () => state.managers,
    count: async () => 0,
  },
  $transaction: async (fn) => fn(prismaFake),
};

// ── Module mocks (must be registered before importing the services) ─────────

mock.module("../source/db/client.js", {
  exports: { default: prismaFake },
});
mock.module("../source/services/notificationService.js", {
  exports: {
    createNotification: async (n) => {
      notifications.push(n);
    },
  },
});

const svc = await import("../source/services/contributionService.js");
const taskSvc = await import("../source/services/taskService.js");

// ── Scenario builders ────────────────────────────────────────────────────────

function makeProject(overrides = {}) {
  return {
    id: "proj1",
    title: "Test Project",
    slug: "test-project",
    ownerId: "owner1",
    memberships: [], // the caller's ACTIVE memberships
    ...overrides,
  };
}

function makeContribution(overrides = {}) {
  return {
    id: "contrib1",
    title: "Built the API",
    status: "PENDING_REVIEW",
    memberAcknowledgedAt: null,
    confirmedAt: null,
    description: null,
    member: {
      id: "mem2",
      userId: "user2",
      user: { id: "user2", name: "Bob Member" },
    },
    project: {
      id: "proj1",
      title: "Test Project",
      slug: "test-project",
      ownerId: "owner1",
    },
    reviews: [],
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    id: "task1",
    title: "Build thing",
    status: "IN_PROGRESS",
    assigneeMemberId: "mem2",
    blockerNote: null,
    startedAt: NOW,
    completedAt: null,
    assignee: { userId: "user2" },
    ...overrides,
  };
}

const OWNER_CONTRIBUTION_MEMBER = {
  id: "mem1",
  userId: "owner1",
  user: { id: "owner1", name: "Olive Owner" },
};

function expectReject(fn, status, messagePattern) {
  return assert.rejects(fn, (err) => {
    assert.equal(err.status, status, `expected ${status}, got ${err.status}: ${err.message}`);
    assert.match(err.message, messagePattern);
    return true;
  });
}

function taskCompletionEntries() {
  return state.evidenceCreates.filter((e) => e.type === "TASK_COMPLETION");
}

// ─────────────────────────────────────────────────────────────────────────────
// Review rules
// ─────────────────────────────────────────────────────────────────────────────

test("owner can confirm their own contribution in a multi-member project", async () => {
  reset();
  // Owner has no membership row — role OWNER comes from project.ownerId.
  state.project = makeProject({ memberships: [] });
  state.contribution = makeContribution({
    member: OWNER_CONTRIBUTION_MEMBER,
    memberAcknowledgedAt: null, // self-review skips the acknowledgement step
  });

  const result = await svc.reviewContribution("owner1", "proj1", "contrib1", {
    decision: "CONFIRMED",
  });

  assert.equal(state.reviewCreates.length, 1);
  assert.equal(state.reviewCreates[0].decision, "CONFIRMED");
  assert.equal(state.reviewCreates[0].reviewerId, "owner1");
  assert.equal(state.updateCalls[0].status, "CONFIRMED");
  assert.ok(state.updateCalls[0].confirmedAt instanceof Date);

  // Contributor (the owner themself) gets the decision notification.
  const reviewNotifs = notifications.filter((n) => n.type === "CONTRIBUTION_REVIEW");
  assert.equal(reviewNotifs.length, 1);
  assert.equal(reviewNotifs[0].userId, "owner1");
  assert.equal(reviewNotifs[0].data.decision, "CONFIRMED");
  assert.equal(result.status, "CONFIRMED");
});

test("manager cannot review their own contribution", async () => {
  reset();
  state.project = makeProject({
    ownerId: "owner1",
    memberships: [{ id: "mem9", accessRole: "MANAGER" }],
  });
  state.contribution = makeContribution({
    member: {
      id: "mem9",
      userId: "mgr1",
      user: { id: "mgr1", name: "Mia Manager" },
    },
  });

  await expectReject(
    () => svc.reviewContribution("mgr1", "proj1", "contrib1", { decision: "CONFIRMED" }),
    403,
    /cannot review your own contribution/,
  );
  assert.equal(state.reviewCreates.length, 0);
});

test("plain member cannot confirm someone else's contribution", async () => {
  reset();
  state.project = makeProject({
    memberships: [{ id: "mem3", accessRole: "MEMBER" }],
  });
  state.contribution = makeContribution({ memberAcknowledgedAt: true });

  await expectReject(
    () => svc.reviewContribution("user3", "proj1", "contrib1", { decision: "CONFIRMED" }),
    403,
    /Only the project owner or a manager can confirm/,
  );
  assert.equal(state.reviewCreates.length, 0);
});

test("confirming a teammate's contribution without acknowledgement is rejected", async () => {
  reset();
  state.project = makeProject({ memberships: [] }); // owner reviewing member's work
  state.contribution = makeContribution({ memberAcknowledgedAt: null });

  await expectReject(
    () => svc.reviewContribution("owner1", "proj1", "contrib1", { decision: "CONFIRMED" }),
    409,
    /has not acknowledged/,
  );
  assert.equal(state.reviewCreates.length, 0);
});

test("CHANGES_REQUESTED resets to PENDING_REVIEW, clears acknowledgement, notifies contributor", async () => {
  reset();
  state.project = makeProject({ memberships: [] });
  state.contribution = makeContribution({ memberAcknowledgedAt: true });

  const result = await svc.reviewContribution("owner1", "proj1", "contrib1", {
    decision: "CHANGES_REQUESTED",
    note: "Add a demo link",
  });

  assert.equal(state.reviewCreates[0].decision, "CHANGES_REQUESTED");
  assert.equal(state.reviewCreates[0].note, "Add a demo link");
  assert.equal(state.updateCalls[0].status, "PENDING_REVIEW");
  assert.equal(state.updateCalls[0].memberAcknowledgedAt, null);
  assert.equal(state.updateCalls[0].confirmedAt, null);

  const reviewNotifs = notifications.filter((n) => n.type === "CONTRIBUTION_REVIEW");
  assert.equal(reviewNotifs.length, 1);
  assert.equal(reviewNotifs[0].userId, "user2"); // the contributor
  assert.equal(reviewNotifs[0].data.decision, "CHANGES_REQUESTED");
  assert.equal(result.status, "PENDING_REVIEW");
});

// ─────────────────────────────────────────────────────────────────────────────
// One summary per member per project
// ─────────────────────────────────────────────────────────────────────────────

test("submitting a second summary is rejected with 409", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem2", accessRole: "MEMBER" }] });
  state.summaryLookup = { id: "contrib1" }; // the member already has a summary

  await expectReject(
    () => svc.submitContribution("user2", "proj1", { title: "Another summary" }),
    409,
    /already have a contribution summary/,
  );
  assert.equal(state.createCalls.length, 0);
  assert.equal(notifications.length, 0);
});

test("submitting a contribution pings owner + managers, not the contributor", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem2", accessRole: "MEMBER" }] });
  state.managers = [{ userId: "mgr1" }];
  state.contributorMember = {
    id: "mem2",
    userId: "user2",
    user: { id: "user2", name: "Bob Member" },
  };

  const created = await svc.submitContribution("user2", "proj1", {
    title: "Shipped the search feature",
    description: "Done",
  });

  assert.equal(state.createCalls.length, 1);
  assert.equal(state.createCalls[0].status, "PENDING_REVIEW");
  assert.equal(created.id, "contrib-new");

  const pings = notifications.filter((n) => n.type === "CONTRIBUTION_SUBMITTED");
  assert.deepEqual(pings.map((n) => n.userId).sort(), ["mgr1", "owner1"]);
  for (const p of pings) {
    assert.equal(p.entityId, "contrib-new");
    assert.equal(p.data.action, "submit");
    assert.match(p.title, /awaiting review/);
    assert.match(p.message, /Bob Member/);
  }
});

test("owner submitting their own contribution pings managers only", async () => {
  reset();
  // Owner with a membership row (submit requires an ACTIVE membership).
  state.project = makeProject({ memberships: [{ id: "mem1", accessRole: "OWNER" }] });
  state.managers = [{ userId: "mgr1" }];
  state.contributorMember = OWNER_CONTRIBUTION_MEMBER;

  await svc.submitContribution("owner1", "proj1", { title: "Owner's own work" });

  const pings = notifications.filter((n) => n.type === "CONTRIBUTION_SUBMITTED");
  assert.deepEqual(pings.map((n) => n.userId), ["mgr1"]); // owner excluded
});

// ─────────────────────────────────────────────────────────────────────────────
// Completed tasks become evidence entries (recordTaskCompletion + updateTask)
// ─────────────────────────────────────────────────────────────────────────────

test("first completed task creates the member's summary and appends a TASK_COMPLETION entry", async () => {
  reset();

  const summary = await svc.recordTaskCompletion(prismaFake, {
    projectId: "proj1",
    memberId: "mem2",
    taskId: "task1",
    taskTitle: "Build thing",
    defaultSummaryTitle: "Contributions to Test Project",
    completionNote: "Did the thing",
    artifactUrl: "https://example.com/demo",
  });

  // Summary created on the spot.
  assert.equal(state.createCalls.length, 1);
  assert.equal(state.createCalls[0].title, "Contributions to Test Project");
  assert.equal(state.createCalls[0].status, "PENDING_REVIEW");
  assert.equal(state.createCalls[0].description, "Did the thing"); // opening description

  // Evidence: the task itself + the supplied link.
  const entries = state.evidenceCreates;
  const taskEntry = entries.find((e) => e.type === "TASK_COMPLETION");
  assert.ok(taskEntry, "TASK_COMPLETION entry created");
  assert.equal(taskEntry.taskId, "task1");
  assert.equal(taskEntry.url, null);
  assert.equal(taskEntry.title, "Build thing");
  assert.ok(entries.some((e) => e.url === "https://example.com/demo"));

  // Silent: no status change on an existing row, no extra description update,
  // and no notifications whatsoever.
  assert.equal(state.updateCalls.length, 0);
  assert.equal(notifications.length, 0);
  assert.equal(summary.status, "PENDING_REVIEW");
});

test("appending to a CONFIRMED summary keeps it confirmed and silent", async () => {
  reset();
  const confirmed = makeContribution({
    status: "CONFIRMED",
    confirmedAt: NOW,
    memberAcknowledgedAt: true,
    description: "First delivery",
  });
  state.summaryLookup = confirmed;
  state.contribution = confirmed;

  const summary = await svc.recordTaskCompletion(prismaFake, {
    projectId: "proj1",
    memberId: "mem2",
    taskId: "task2",
    taskTitle: "Second feature",
    defaultSummaryTitle: "Contributions to Test Project",
    completionNote: "Follow-up work",
  });

  // No new summary, status and acknowledgement untouched.
  assert.equal(state.createCalls.length, 0);
  assert.equal(summary.status, "CONFIRMED");
  assert.equal(state.updateCalls.length, 1);
  assert.equal(state.updateCalls[0].description, "First delivery\n\nFollow-up work");
  assert.equal(state.updateCalls[0].memberAcknowledgedAt, undefined);
  assert.equal(state.updateCalls[0].status, undefined);

  // Evidence appended, reviewers never pinged.
  assert.equal(taskCompletionEntries().length, 1);
  assert.equal(taskCompletionEntries()[0].taskId, "task2");
  assert.equal(notifications.length, 0);
});

test("re-completing a task never duplicates its evidence entry", async () => {
  reset();
  const confirmed = makeContribution({ status: "CONFIRMED", memberAcknowledgedAt: true });
  state.summaryLookup = confirmed;
  state.contribution = confirmed;
  // The task already has its entry (and the link) from the first completion.
  state.evidenceCreates.push(
    { contributionId: "contrib1", taskId: "task1", type: "TASK_COMPLETION", title: "Build thing", url: null },
    { contributionId: "contrib1", type: "LIVE_DEMO", title: "Artifact link", url: "https://example.com/demo" },
  );

  await svc.recordTaskCompletion(prismaFake, {
    projectId: "proj1",
    memberId: "mem2",
    taskId: "task1",
    taskTitle: "Build thing",
    defaultSummaryTitle: "Contributions to Test Project",
    artifactUrl: "https://example.com/demo", // same link again
  });

  assert.equal(taskCompletionEntries().length, 1);
  const linkEntries = state.evidenceCreates.filter((e) => e.url === "https://example.com/demo");
  assert.equal(linkEntries.length, 1); // de-duplicated
});

test("PATCH task → COMPLETED appends the entry to the assignee's summary", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem2", accessRole: "MEMBER" }] });
  state.task = makeTask(); // assignee = mem2 = caller's membership

  const result = await taskSvc.updateTask("user2", "proj1", "task1", {
    status: "COMPLETED",
  });

  assert.equal(result.task.status, "COMPLETED");
  assert.equal(state.taskUpdateCalls[0].status, "COMPLETED");

  // The summary was created for the member, with the task as evidence.
  assert.equal(state.createCalls.length, 1);
  assert.equal(state.createCalls[0].memberId, "mem2");
  const entries = taskCompletionEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].taskId, "task1");
  assert.equal(entries[0].url, null);

  // Completely silent — no reviewer ping, no assignee ping.
  assert.equal(notifications.length, 0);
  assert.equal(result.contribution.status, "PENDING_REVIEW");
});

test("completing a task appends to an existing CONFIRMED summary without reopening it", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem2", accessRole: "MEMBER" }] });
  state.task = makeTask();
  const confirmed = makeContribution({
    status: "CONFIRMED",
    confirmedAt: NOW,
    memberAcknowledgedAt: true,
  });
  state.summaryLookup = confirmed;
  state.contribution = confirmed;

  const result = await taskSvc.updateTask("user2", "proj1", "task1", {
    status: "COMPLETED",
    contribution: { completionNote: "Wrapped up the remaining edges." },
  });

  assert.equal(state.createCalls.length, 0); // no new summary
  assert.equal(result.contribution.status, "CONFIRMED"); // stayed confirmed
  assert.equal(taskCompletionEntries().length, 1);
  // The note rode along on the description; nothing else changed.
  assert.equal(state.updateCalls.length, 1);
  assert.equal(state.updateCalls[0].status, undefined);
  assert.equal(notifications.length, 0);
});

test("completing an already-completed task with a contribution block is rejected", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem2", accessRole: "MEMBER" }] });
  state.task = makeTask({ status: "COMPLETED", completedAt: NOW });

  await expectReject(
    () => taskSvc.updateTask("user2", "proj1", "task1", {
      status: "COMPLETED",
      contribution: { title: "Again" },
    }),
    409,
    /add evidence to your summary/,
  );
  assert.equal(state.createCalls.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Manual evidence endpoint
// ─────────────────────────────────────────────────────────────────────────────

test("only the contributor can add evidence to the summary", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem3", accessRole: "MEMBER" }] });
  state.contribution = makeContribution();

  await expectReject(
    () => svc.addContributionEvidence("user3", "proj1", "contrib1", {
      url: "https://example.com/x",
    }),
    403,
    /Only the contributor can add evidence/,
  );
  assert.equal(state.evidenceCreates.length, 0);
});

test("adding evidence is silent: creates the entry without touching status or notifying", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem2", accessRole: "MEMBER" }] });
  state.contribution = makeContribution({ status: "CONFIRMED", memberAcknowledgedAt: true });

  const result = await svc.addContributionEvidence("user2", "proj1", "contrib1", {
    url: "https://github.com/example/pull/42",
    title: "Merged PR #42",
    type: "REPOSITORY",
  });

  assert.equal(state.evidenceCreates.length, 1);
  assert.deepEqual(state.evidenceCreates[0], {
    contributionId: "contrib1",
    title: "Merged PR #42",
    url: "https://github.com/example/pull/42",
    type: "REPOSITORY",
  });
  assert.equal(result.evidence.type, "REPOSITORY");

  // Silent: no update, no status change, no notification.
  assert.equal(state.updateCalls.length, 0);
  assert.equal(notifications.length, 0);

  // Default type when omitted.
  await svc.addContributionEvidence("user2", "proj1", "contrib1", {
    url: "https://example.com/demo",
  });
  assert.equal(state.evidenceCreates[1].type, "OTHER");
  assert.equal(state.evidenceCreates[1].title, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Edit & resubmit (PATCH) after CHANGES_REQUESTED
// ─────────────────────────────────────────────────────────────────────────────

test("PATCH rejects an edit by anyone but the contributor", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem3", accessRole: "MEMBER" }] });
  state.contribution = makeContribution({
    reviews: [{ decision: "CHANGES_REQUESTED" }],
  });

  await expectReject(
    () => svc.editContribution("user3", "proj1", "contrib1", { title: "Hacked" }),
    403,
    /Only the contributor can edit/,
  );
  assert.equal(state.updateCalls.length, 0);
});

test("PATCH rejects when the latest review is not CHANGES_REQUESTED", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem2", accessRole: "MEMBER" }] });
  state.contribution = makeContribution({ reviews: [] }); // fresh submission

  await expectReject(
    () => svc.editContribution("user2", "proj1", "contrib1", { title: "Sneaky edit" }),
    409,
    /Only a contribution with requested changes/,
  );
  assert.equal(state.updateCalls.length, 0);
});

test("PATCH rejects editing an already confirmed contribution", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem2", accessRole: "MEMBER" }] });
  state.contribution = makeContribution({
    status: "CONFIRMED",
    memberAcknowledgedAt: true,
    reviews: [{ decision: "CHANGES_REQUESTED" }], // confirmed check wins
  });

  await expectReject(
    () => svc.editContribution("user2", "proj1", "contrib1", { title: "Nope" }),
    409,
    /already confirmed/,
  );
  assert.equal(state.updateCalls.length, 0);
});

test("PATCH edits and resubmits: PENDING_REVIEW, ack cleared, task evidence preserved, reviewers pinged", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem2", accessRole: "MEMBER" }] });
  state.contribution = makeContribution({
    reviews: [{ decision: "CHANGES_REQUESTED" }],
    memberAcknowledgedAt: null,
  });
  state.managers = [{ userId: "mgr1" }];

  const result = await svc.editContribution("user2", "proj1", "contrib1", {
    title: "Built the API v2",
    description: "Revised with demo",
    artifactUrl: "https://example.com/demo",
    fileType: "LIVE_DEMO",
  });

  // Old MANUAL evidence wiped, new evidence attached — but TASK_COMPLETION
  // entries (completed tasks) must survive the rebuild.
  assert.equal(state.evidenceDeletes.length, 1);
  assert.equal(state.evidenceDeletes[0].where.contributionId, "contrib1");
  assert.deepEqual(state.evidenceDeletes[0].where.type, { not: "TASK_COMPLETION" });

  const data = state.updateCalls[0];
  assert.equal(data.title, "Built the API v2");
  assert.equal(data.description, "Revised with demo");
  assert.equal(data.status, "PENDING_REVIEW");
  assert.equal(data.memberAcknowledgedAt, null);
  assert.equal(data.evidence.create.length, 1);
  assert.equal(data.evidence.create[0].url, "https://example.com/demo");

  // "Please-review" ping: owner + manager, never the contributor.
  const pings = notifications.filter((n) => n.type === "CONTRIBUTION_SUBMITTED");
  assert.deepEqual(pings.map((n) => n.userId).sort(), ["mgr1", "owner1"]);
  for (const p of pings) {
    assert.equal(p.entityId, "contrib1");
    assert.equal(p.data.action, "resubmit");
  }
  assert.equal(result.title, "Built the API v2");
});

test("PATCH with a title only keeps existing evidence", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem2", accessRole: "MEMBER" }] });
  state.contribution = makeContribution({
    reviews: [{ decision: "CHANGES_REQUESTED" }],
  });

  await svc.editContribution("user2", "proj1", "contrib1", { title: "Renamed only" });

  assert.equal(state.evidenceDeletes.length, 0);
  const data = state.updateCalls[0];
  assert.equal(data.title, "Renamed only");
  assert.equal(data.evidence, undefined); // untouched
  assert.equal(data.status, "PENDING_REVIEW");
  assert.equal(data.memberAcknowledgedAt, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// "Please-review" notifications on acknowledge
// ─────────────────────────────────────────────────────────────────────────────

test("first acknowledgement does not ping reviewers", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem2", accessRole: "MEMBER" }] });
  state.contribution = makeContribution({ reviews: [] });

  await svc.acknowledgeContribution("user2", "proj1", "contrib1");

  assert.equal(state.updateCalls[0].memberAcknowledgedAt instanceof Date, true);
  assert.equal(notifications.length, 0);
});

test("re-acknowledging after requested changes pings reviewers again", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem2", accessRole: "MEMBER" }] });
  state.contribution = makeContribution({
    reviews: [{ decision: "CHANGES_REQUESTED" }],
    memberAcknowledgedAt: null,
  });
  state.managers = [{ userId: "mgr1" }];

  await svc.acknowledgeContribution("user2", "proj1", "contrib1");

  const pings = notifications.filter((n) => n.type === "CONTRIBUTION_SUBMITTED");
  assert.deepEqual(pings.map((n) => n.userId).sort(), ["mgr1", "owner1"]);
  for (const p of pings) {
    assert.equal(p.data.action, "acknowledge");
  }
});

test("a non-contributor cannot acknowledge someone else's summary", async () => {
  reset();
  state.project = makeProject({ memberships: [{ id: "mem3", accessRole: "MEMBER" }] });
  state.contribution = makeContribution();

  await expectReject(
    () => svc.acknowledgeContribution("user3", "proj1", "contrib1"),
    403,
    /Only the contributor can acknowledge/,
  );
  assert.equal(state.updateCalls.length, 0);
});
