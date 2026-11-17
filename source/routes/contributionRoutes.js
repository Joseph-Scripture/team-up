import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { validate }     from "../middleware/validateResults.js";
import {
  listContributionsRules,
  contributionParamRules,
  projectIdParamRule,
  reviewContributionRules,
  submitContributionRules,
} from "../middleware/validateContribution.js";
import {
  ListContributions,
  GetContributionSummary,
  GetContribution,
  SubmitContribution,
  AcknowledgeContribution,
  ReviewContribution,
} from "../controllers/contributionController.js";

// ─────────────────────────────────────────────────────────────────────────────
// Project-scoped contribution router
// Mounted at /api/projects/:projectId/contributions in projectRoutes.js
// mergeParams: true forwards :projectId from the parent router.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });

// All contribution routes require a valid session.
router.use(authenticate);

/**
 * GET /api/projects/:projectId/contributions
 * List contributions on a project. Supports ?status, ?page, ?limit.
 * Any active project member can call this.
 */
router.get(
  "/",
  listContributionsRules,
  validate,
  ListContributions,
);

/**
 * POST /api/projects/:projectId/contributions
 * Submit your own contribution summary (step 1 of 2).
 */
router.post(
  "/",
  submitContributionRules,
  validate,
  SubmitContribution,
);

/**
 * GET /api/projects/:projectId/contributions/summary
 * Confirmed contributions only — used for the project page summary.
 */
router.get(
  "/summary",
  projectIdParamRule,
  validate,
  GetContributionSummary,
);

/**
 * GET /api/projects/:projectId/contributions/:contributionId
 * A single contribution with its full review history.
 */
router.get(
  "/:contributionId",
  contributionParamRules,
  validate,
  GetContribution,
);

/**
 * POST /api/projects/:projectId/contributions/:contributionId/acknowledge
 * The contributor reviews their own summary (step 2 of 2).
 */
router.post(
  "/:contributionId/acknowledge",
  contributionParamRules,
  validate,
  AcknowledgeContribution,
);

/**
 * POST /api/projects/:projectId/contributions/:contributionId/review
 * Confirm (owner / manager) or request changes (any non-contributor member).
 */
router.post(
  "/:contributionId/review",
  reviewContributionRules,
  validate,
  ReviewContribution,
);

export default router;
