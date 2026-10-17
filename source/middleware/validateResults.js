import {validationResult } from 'express-validator'

// This middleware's only job is to check for errors and display them
export function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  return res.status(400).json({
    message: "Invalid input",
    errors: result.array({ onlyFirstError: true }).map((e) => ({ field: e.path, message: e.msg })),
  });
}
