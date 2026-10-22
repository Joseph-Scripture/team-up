import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { validateDraft, validatePublish } from "../middleware/validateProject.js";
import {
  CreateDraft,
  UpdateDraft,
  PublishProject,
  GetMyProjects,
  GetProject,
  DeleteProject,
} from "../controllers/projectController.js";

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

router.get("/mine", GetMyProjects);

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
router.put("/:id", validateDraft, UpdateDraft);

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

export default router;
