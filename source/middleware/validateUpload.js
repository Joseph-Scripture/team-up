import { body } from "express-validator";

const VALID_CONTEXTS = ["contribution", "avatar", "evidence"];

export const signUploadRules = [
  body("filename")
    .isString().withMessage("filename is required").bail()
    .trim().notEmpty().withMessage("filename must not be empty")
    .isLength({ max: 255 }).withMessage("filename must be at most 255 characters"),

  body("contentType")
    .isString().withMessage("contentType is required").bail()
    .trim().notEmpty().withMessage("contentType must not be empty"),

  body("context")
    .optional()
    .isString().trim()
    .isIn(VALID_CONTEXTS)
    .withMessage(`context must be one of: ${VALID_CONTEXTS.join(", ")}`),
];
