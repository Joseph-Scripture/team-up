/**
 * Reject requests whose body is not JSON. Without this, a multipart file sent
 * to a JSON-only endpoint is silently ignored because express.json() leaves
 * req.body empty and every field in the validator is optional.
 */
export function requireJson(req, res, next) {
  if (req.is("application/json")) return next();
  return res.status(415).json({
    message: "Content-Type must be application/json. Upload files with POST /api/uploads first, then send the returned fileUrl in this request.",
  });
}

/**
 * Reject unknown top-level body fields. This turns typos such as "avatar" or
 * "avatar_url" into a clear 400 instead of a silent no-op.
 */
export function rejectUnknownFields(allowedFields) {
  const allowed = new Set(allowedFields);
  return (req, res, next) => {
    const unknown = Object.keys(req.body ?? {}).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      return res.status(400).json({
        message: `Unknown field(s): ${unknown.join(", ")}`,
      });
    }
    return next();
  };
}
