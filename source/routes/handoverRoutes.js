import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { validate }     from "../middleware/validateResults.js";
import {
  requestHandoverRules,
  listHandoverRequestsRules,
  acceptHandoverRules,
  handoverRequestParamRules,
} from "../middleware/validateHandover.js";
import {
  RequestHandover,
  ListHandoverRequests,
  AcceptHandover,
  DeclineHandover,
  CancelHandover,
} from "../controllers/handoverController.js";

// Project-scoped handover router.
// Mounted at /api/projects/:projectId in projectRoutes.js.
// mergeParams: true forwards :projectId from the parent router.
const router = Router({ mergeParams: true });

router.use(authenticate);

/**
 * POST /api/projects/:projectId/tasks/:taskId/handover-request
 * The task owner asks the project owner to hand the task over.
 */
router.post(
  "/tasks/:taskId/handover-request",
  requestHandoverRules,
  validate,
  RequestHandover,
);

/**
 * GET /api/projects/:projectId/handover-requests
 * Project owner and managers (read-only for managers).
 */
router.get(
  "/handover-requests",
  listHandoverRequestsRules,
  validate,
  ListHandoverRequests,
);

/**
 * POST /api/projects/:projectId/handover-requests/:requestId/accept
 * Project owner only — accepting reassigns the task.
 */
router.post(
  "/handover-requests/:requestId/accept",
  acceptHandoverRules,
  validate,
  AcceptHandover,
);

/**
 * POST /api/projects/:projectId/handover-requests/:requestId/decline
 * Project owner or manager. The task keeps its owner.
 */
router.post(
  "/handover-requests/:requestId/decline",
  handoverRequestParamRules,
  validate,
  DeclineHandover,
);

/**
 * POST /api/projects/:projectId/handover-requests/:requestId/cancel
 * The requester withdraws their own request.
 */
router.post(
  "/handover-requests/:requestId/cancel",
  handoverRequestParamRules,
  validate,
  CancelHandover,
);

export default router;
