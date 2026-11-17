import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { validate }     from "../middleware/validateResults.js";
import { addEvidenceRules, updateEvidenceRules, evidenceParamRules, projectEvidenceRules } from "../middleware/validateEvidence.js";
import {
  ListEvidence,
  AddEvidence,
  UpdateEvidence,
  DeleteEvidence,
} from "../controllers/evidenceController.js";

// Project-scoped deliverables router.
// Mounted at /api/projects/:projectId/evidence in projectRoutes.js.
// mergeParams: true forwards :projectId from the parent router.
const router = Router({ mergeParams: true });

router.use(authenticate);

/**
 * GET /api/projects/:projectId/evidence
 * List the deliverables of a project (any active member).
 */
router.get("/", projectEvidenceRules, validate, ListEvidence);

/**
 * POST /api/projects/:projectId/evidence
 * Add a deliverable (owner / manager).
 */
router.post("/", addEvidenceRules, validate, AddEvidence);

/**
 * PATCH /api/projects/:projectId/evidence/:evidenceId
 * Update a deliverable (owner / manager). PUT is accepted as an alias.
 */
router.patch("/:evidenceId", updateEvidenceRules, validate, UpdateEvidence);
router.put("/:evidenceId", updateEvidenceRules, validate, UpdateEvidence);

/**
 * DELETE /api/projects/:projectId/evidence/:evidenceId
 * Remove a deliverable (owner / manager).
 */
router.delete("/:evidenceId", evidenceParamRules, validate, DeleteEvidence);

export default router;
