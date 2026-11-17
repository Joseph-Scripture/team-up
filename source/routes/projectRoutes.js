import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { validateDraft, validateDraftUpdate, validatePublish, validateComplete } from "../middleware/validateProject.js";
import {
  CreateDraft,
  UpdateDraft,
  PublishProject,
  GetMyProjects,
  GetProject,
  GetProjectHealth,
  DeleteProject,
  SearchProjects,
  ShareProject,
  UnshareProject,
  CompleteProject,
} from "../controllers/projectController.js";
import { GetRecommendedProjects } from "../controllers/dashboardController.js";
import { FindCollaborators } from "../controllers/invitationController.js";
import { findCollaboratorsRules } from "../middleware/validateInvitation.js";
import { validate } from "../middleware/validateResults.js";
import invitationRoutes from "./invitationRoutes.js";
import joinRequestRoutes from "./joinRequestRoutes.js";
import dateExtensionRoutes from "./dateExtensionRoutes.js";
import taskRoutes        from "./taskRoutes.js";
import contributionRoutes from "./contributionRoutes.js";
import evidenceRoutes from "./evidenceRoutes.js";
import handoverRoutes from "./handoverRoutes.js";

const router = Router();

// All project routes require authentication.
router.use(authenticate);

/**
 * @openapi
 * /api/projects/mine:
 *   get:
 *     tags: [Projects]
 *     summary: List the authenticated user's projects (drafts + published)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of projects }
 *       401: { description: Authentication required }
 */

// NOTE: /mine, /recommended, and /browse must be declared BEFORE /:id so Express does
// not treat the literal strings as project IDs.
router.get("/mine", GetMyProjects);

/**
 * @openapi
 * /api/projects/recommended:
 *   get:
 *     tags: [Projects]
 *     summary: Get personalised project recommendations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 20, default: 6 }
 *     responses:
 *       200: { description: Ranked recommendations }
 *       401: { description: Authentication required }
 */
router.get("/recommended", GetRecommendedProjects);

// GET /api/projects — browse / search all open projects (Discover Projects screen)
// Must be before /:id to avoid "projects" being treated as an ID.
router.get("/", SearchProjects);

/**
 * @openapi
 * /api/projects:
 *   post:
 *     tags: [Projects]
 *     summary: Create a new project draft
 *     security:
 *       - bearerAuth: []
 */
router.post("/", validateDraft, CreateDraft);

/**
 * @openapi
 * /api/projects/{projectId}/collaborators:
 *   get:
 *     tags: [Projects]
 *     summary: Find eligible collaborators for an open role
 *     description: >
 *       Owner / manager only. Returns active onboarded users that are not yet
 *       members and have no pending invitation or join request for this project.
 *       Accepts optional filters for skills, project type, preferred duration and
 *       weekly availability. Always returns a top-level `count` of matching users.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: roleId
 *         required: true
 *         schema: { type: string }
 */
router.get(
  "/:projectId/collaborators",
  findCollaboratorsRules,
  validate,
  FindCollaborators,
);

/**
 * @openapi
 * /api/projects/{id}:
 *   get:
 *     tags: [Projects]
 *     summary: Get a project by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.get("/:id", GetProject);

/**
 * @openapi
 * /api/projects/{projectId}/health:
 *   get:
 *     tags: [Projects]
 *     summary: Get the team health of a project
 *     description: >
 *       One status for the whole team — never a score for an individual.
 *       `AT_RISK` (an overdue milestone or an inactive member) wins over
 *       `NEEDS_ATTENTION` (an overdue task, a blocked task, a task stuck in
 *       review, or a missed check-in), which wins over `ON_TRACK`.
 *
 *       Only team members can read it. Everybody else gets `404` — the
 *       endpoint deliberately cannot be used to discover that a project
 *       exists, so "not allowed" and "not found" are indistinguishable.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The team health payload (`status`, `reasons`, `signals`).
 *       404:
 *         description: Project not found, or the caller is not on the team.
 */
router.get("/:projectId/health", GetProjectHealth);

/**
 * @openapi
 * /api/projects/{id}:
 *   put:
 *     tags: [Projects]
 *     summary: Update a draft project
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.put("/:id", validateDraftUpdate, UpdateDraft);

/**
 * @openapi
 * /api/projects/{id}/publish:
 *   post:
 *     tags: [Projects]
 *     summary: Publish a draft project (DRAFT → OPEN)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.post("/:id/publish", validatePublish, PublishProject);

/**
 * @openapi
 * /api/projects/{id}/complete:
 *   post:
 *     tags: [Projects]
 *     summary: Complete the project (owner only)
 *     security:
 *       - bearerAuth: []
 */
router.post("/:id/complete", validateComplete, CompleteProject);

/**
 * @openapi
 * /api/projects/{id}/share:
 *   post:
 *     tags: [Projects]
 *     summary: Share the project page
 *     security:
 *       - bearerAuth: []
 */
router.post("/:id/share", ShareProject);

/**
 * @openapi
 * /api/projects/{id}/unshare:
 *   post:
 *     tags: [Projects]
 *     summary: Make the project page private to the team
 *     security:
 *       - bearerAuth: []
 */
router.post("/:id/unshare", UnshareProject);

/**
 * @openapi
 * /api/projects/{id}:
 *   delete:
 *     tags: [Projects]
 *     summary: Soft-delete a project
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.delete("/:id", DeleteProject);

// ─────────────────────────────────────────────────────────────────────────────
// Project-scoped invitation routes
// Mounts: POST/GET /api/projects/:projectId/invitations
// The :projectId param is forwarded via mergeParams in the sub-router.
// ─────────────────────────────────────────────────────────────────────────────
router.use("/:projectId/invitations", invitationRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// Project-scoped join request routes
// Mounts: POST/GET /api/projects/:projectId/join-requests
//         POST     /api/projects/:projectId/join-requests/:requestId/approve|decline
//         GET      /api/projects/:projectId/join-requests/:requestId
// The :projectId param is forwarded via mergeParams in the sub-router.
// ─────────────────────────────────────────────────────────────────────────────
router.use("/:projectId/join-requests", joinRequestRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// Project-scoped date extension request routes
// Mounts: POST/GET /api/projects/:projectId/date-extension-requests
//         GET/PATCH /api/projects/:projectId/date-extension-requests/:requestId
// The :projectId param is forwarded via mergeParams in the sub-router.
// ─────────────────────────────────────────────────────────────────────────────
router.use("/:projectId/date-extension-requests", dateExtensionRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// Project-scoped contribution routes
// Mounts: GET  /api/projects/:projectId/contributions
//         GET  /api/projects/:projectId/contributions/summary
//         GET  /api/projects/:projectId/contributions/:contributionId
//         POST /api/projects/:projectId/contributions/:contributionId/review
// The :projectId param is forwarded via mergeParams in the sub-router.
// ─────────────────────────────────────────────────────────────────────────────
router.use("/:projectId/contributions", contributionRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// Project-scoped deliverable routes
// Mounts: GET/POST /api/projects/:projectId/evidence
//         DELETE /api/projects/:projectId/evidence/:evidenceId
// ─────────────────────────────────────────────────────────────────────────────
router.use("/:projectId/evidence", evidenceRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// Project-scoped handover routes
// Mounts: POST   /api/projects/:projectId/tasks/:taskId/handover-request
//         GET    /api/projects/:projectId/handover-requests
//         POST   /api/projects/:projectId/handover-requests/:requestId/decline
//         POST   /api/projects/:projectId/handover-requests/:requestId/cancel
// ─────────────────────────────────────────────────────────────────────────────
router.use("/:projectId", handoverRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// Project-scoped task, milestone, and team update routes
// Mounts: POST/GET /api/projects/:projectId/milestones
//         POST/GET /api/projects/:projectId/tasks (+ /:taskId + comments)
//         POST/GET /api/projects/:projectId/updates
// ─────────────────────────────────────────────────────────────────────────────
router.use("/:projectId", taskRoutes);

export default router;
