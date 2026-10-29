import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { validate }     from "../middleware/validateResults.js";
import {
  sendJoinRequestRules,
  listProjectJoinRequestsRules,
  listMyJoinRequestsRules,
  joinRequestIdParamRules,
  projectAndRequestIdParamRules,
  decisionRules,
} from "../middleware/validateJoinRequest.js";
import {
  SendJoinRequest,
  ListProjectJoinRequests,
  GetJoinRequestDetail,
  ApproveJoinRequest,
  DeclineJoinRequest,
  ListMyJoinRequests,
  WithdrawJoinRequest,
  ConfirmJoinRequest,
} from "../controllers/joinRequestController.js";

// ─────────────────────────────────────────────────────────────────────────────
// Project-scoped router  (owner / manager actions + applicant send)
// Mounted at /api/projects/:projectId/join-requests in projectRoutes.js
// mergeParams: true forwards :projectId from the parent router.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });

router.use(authenticate);

/**
 * POST /api/projects/:projectId/join-requests
 * Send a join request for a role on this project.
 */
router.post(
  "/",
  sendJoinRequestRules,
  validate,
  SendJoinRequest,
);

/**
 * GET /api/projects/:projectId/join-requests
 * List all join requests for this project (owner / manager only).
 * Supports ?status, ?page, ?limit
 */
router.get(
  "/",
  listProjectJoinRequestsRules,
  validate,
  ListProjectJoinRequests,
);

/**
 * GET /api/projects/:projectId/join-requests/:requestId
 * Full detail of a single request — for the review screen (owner) and
 * the commit screen (applicant).
 */
router.get(
  "/:requestId",
  projectAndRequestIdParamRules,
  validate,
  GetJoinRequestDetail,
);

/**
 * POST /api/projects/:projectId/join-requests/:requestId/approve
 * Approve a PENDING request (owner / manager). Does NOT create membership.
 */
router.post(
  "/:requestId/approve",
  decisionRules,
  validate,
  ApproveJoinRequest,
);

/**
 * POST /api/projects/:projectId/join-requests/:requestId/decline
 * Decline a PENDING request (owner / manager).
 */
router.post(
  "/:requestId/decline",
  decisionRules,
  validate,
  DeclineJoinRequest,
);

export default router;

// ─────────────────────────────────────────────────────────────────────────────
// Requester-scoped router  (applicant's own actions)
// Mounted at /api/join-requests in index.js
// ─────────────────────────────────────────────────────────────────────────────

export const requesterRouter = Router();

requesterRouter.use(authenticate);

/**
 * GET /api/join-requests
 * List requests sent by the authenticated user.
 * Supports ?status, ?page, ?limit
 */
requesterRouter.get(
  "/",
  listMyJoinRequestsRules,
  validate,
  ListMyJoinRequests,
);

/**
 * POST /api/join-requests/:requestId/withdraw
 * Withdraw a PENDING or ACCEPTED request.
 */
requesterRouter.post(
  "/:requestId/withdraw",
  joinRequestIdParamRules,
  validate,
  WithdrawJoinRequest,
);

/**
 * POST /api/join-requests/:requestId/confirm
 * Confirm commitment after owner approval — creates membership.
 */
requesterRouter.post(
  "/:requestId/confirm",
  joinRequestIdParamRules,
  validate,
  ConfirmJoinRequest,
);
