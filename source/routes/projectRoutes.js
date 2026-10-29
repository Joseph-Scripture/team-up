import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { validateDraft, validateDraftUpdate, validatePublish } from "../middleware/validateProject.js";
import {
  CreateDraft,
  UpdateDraft,
  PublishProject,
  GetMyProjects,
  GetProject,
  DeleteProject,
} from "../controllers/projectController.js";
import { GetRecommendedProjects } from "../controllers/dashboardController.js";
import { FindCollaborators } from "../controllers/invitationController.js";
import { findCollaboratorsRules } from "../middleware/validateInvitation.js";
import { validate } from "../middleware/validateResults.js";
import invitationRoutes from "./invitationRoutes.js";

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

// NOTE: /mine and /recommended must be declared BEFORE /:id so Express does
// not treat the literal strings "mine" or "recommended" as project IDs.
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

export default router;
