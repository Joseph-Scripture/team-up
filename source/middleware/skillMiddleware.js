import { query } from "express-validator";

export const skillQueryRules = [
  query("q").optional().isString().trim().isLength({ max: 80 }).withMessage("q must be at most 80 characters"),
  query("category").optional().isString().trim().isLength({ max: 60 }).withMessage("category must be at most 60 characters"),
];
