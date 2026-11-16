import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { validate } from "../middleware/validateResults.js";
import {
  createDateExtensionRequestRules,
  listProjectDateExtensionRequestsRules,
  listMyDateExtensionRequestsRules,
  dateExtensionRequestParamRules,
  updateDateExtensionRequestRules,
} from "../middleware/validateDateExtension.js";
import {
  CreateDateExtensionRequest,
  ListProjectDateExtensionRequests,
  ListMyDateExtensionRequests,
  GetDateExtensionRequest,
  UpdateDateExtensionRequest,
} from "../controllers/dateExtensionController.js";

// ─────────────────────────────────────────────────────────────────────────────
// Project-scoped router
// Mounted at /api/projects/:projectId/date-extension-requests in projectRoutes.js
// mergeParams: true forwards :projectId from the parent router.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });

router.use(authenticate);

/**
 * POST /api/projects/:projectId/date-extension-requests
 * Request a new deadline for a task (taskId) or for the project itself.
 */
router.post(
  "/",
  createDateExtensionRequestRules,
  validate,
  CreateDateExtensionRequest,
);

/**
 * GET /api/projects/:projectId/date-extension-requests
 * List requests for the project (owner / manager only).
 * Supports ?status, ?taskId, ?page, ?limit
 */
router.get(
  "/",
  listProjectDateExtensionRequestsRules,
  validate,
  ListProjectDateExtensionRequests,
);

/**
 * GET /api/projects/:projectId/date-extension-requests/:requestId
 * Detail view for the requester or a project owner/manager.
 */
router.get(
  "/:requestId",
  dateExtensionRequestParamRules,
  validate,
  GetDateExtensionRequest,
);

/**
 * PATCH /api/projects/:projectId/date-extension-requests/:requestId
 * Owner/manager decision (ACCEPTED | DECLINED) or requester withdrawal.
 */
router.patch(
  "/:requestId",
  updateDateExtensionRequestRules,
  validate,
  UpdateDateExtensionRequest,
);

export default router;

// ─────────────────────────────────────────────────────────────────────────────
// Requester-scoped router
// Mounted at /api/date-extension-requests in index.js
// ─────────────────────────────────────────────────────────────────────────────

export const requesterRouter = Router();

requesterRouter.use(authenticate);

/**
 * GET /api/date-extension-requests
 * List requests sent by the authenticated user.
 * Supports ?status, ?page, ?limit
 */
requesterRouter.get(
  "/",
  listMyDateExtensionRequestsRules,
  validate,
  ListMyDateExtensionRequests,
);
