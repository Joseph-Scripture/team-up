import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { validate }     from "../middleware/validateResults.js";
import {
  sendInvitationRules,
  listProjectInvitationsRules,
  listMyInvitationsRules,
  invitationIdParamRules,
} from "../middleware/validateInvitation.js";
import {
  SendInvitation,
  ListProjectInvitations,
  ListMyInvitations,
  AcceptInvitation,
  DeclineInvitation,
} from "../controllers/invitationController.js";

const router = Router({ mergeParams: true });

// All invitation routes require a valid session.
router.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
// Project-scoped routes  (owner / manager sends and views invitations)
// Mounted at /api/projects/:projectId/invitations in index.js
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/projects/:projectId/invitations
 * Send an invitation to a user for a specific role on this project.
 */
router.post(
  "/",
  sendInvitationRules,
  validate,
  SendInvitation,
);

/**
 * GET /api/projects/:projectId/invitations
 * List invitations sent for this project (owner / manager only).
 * Supports ?status, ?roleId, ?page, ?limit
 */
router.get(
  "/",
  listProjectInvitationsRules,
  validate,
  ListProjectInvitations,
);

// ─────────────────────────────────────────────────────────────────────────────
// Invitee-scoped routes  (mounted at /api/invitations in index.js)
// These are exported separately and mounted on a second router instance.
// ─────────────────────────────────────────────────────────────────────────────

export const inviteeRouter = Router();

inviteeRouter.use(authenticate);

/**
 * GET /api/invitations
 * List invitations received by the authenticated user.
 * Supports ?status, ?page, ?limit
 */
inviteeRouter.get(
  "/",
  listMyInvitationsRules,
  validate,
  ListMyInvitations,
);

/**
 * POST /api/invitations/:invitationId/accept
 * Accept a pending invitation.
 */
inviteeRouter.post(
  "/:invitationId/accept",
  invitationIdParamRules,
  validate,
  AcceptInvitation,
);

/**
 * POST /api/invitations/:invitationId/decline
 * Decline a pending invitation.
 */
inviteeRouter.post(
  "/:invitationId/decline",
  invitationIdParamRules,
  validate,
  DeclineInvitation,
);

export default router;
