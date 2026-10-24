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

/** Validates a Publish request (all fields required). */
export const validatePublish = [...publishRules, check];
