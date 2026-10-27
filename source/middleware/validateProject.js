import { validationResult } from "express-validator";
import { saveDraftRules, updateDraftRules, publishRules } from "../validation/projectSchemas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Core checker — same shape as the existing validateResults middleware but
// kept separate so project routes stay self-contained.
// ─────────────────────────────────────────────────────────────────────────────

function check(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  return res.status(400).json({
    message: "Invalid input",
    errors: result.array({ onlyFirstError: true }).map((e) => ({
      field: e.path,
      message: e.msg,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Composed middleware arrays — drop either into a route definition.
//
//   router.post("/",          validateDraft,   CreateDraft);
//   router.post("/:id/publish", validatePublish, PublishProject);
// ─────────────────────────────────────────────────────────────────────────────

/** Validates a create-draft request (title required). */
export const validateDraft = [...saveDraftRules, check];

/** Validates an update-draft request (everything optional — project already exists). */
export const validateDraftUpdate = [...updateDraftRules, check];

/**
 * Validates a Publish request.
 *
 * Two valid publish flows:
 *
 *   1. Empty body `{}` — all data was already saved via PUT requests.
 *      Skip express-validator entirely; the service's own completeness
 *      check will catch any missing fields and return a clear 400.
 *
 *   2. Body contains data — the frontend is saving + publishing in one
 *      call. Run publishRules to validate the incoming fields before
 *      writing them to the DB.
 */
export function validatePublish(req, res, next) {
  if (Object.keys(req.body).length === 0) {
    // Nothing to validate — delegate entirely to the service check.
    return next();
  }
  // Body has data — run the full publish rules against it.
  Promise.all(publishRules.map((rule) => rule.run(req))).then(() => check(req, res, next));
}
