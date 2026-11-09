import multer from "multer";
import { MAX_BYTES, ALLOWED_TYPES, VALID_CONTEXTS } from "../services/uploadService.js";

// Use memory storage — the buffer is uploaded directly to Cloudinary.
// No files are ever written to disk.
const storage = multer.memoryStorage();

/**
 * fileFilter runs before the file bytes are buffered into memory.
 *
 * The context is read from the query string first, then from the body. The
 * body fallback is only a best effort because multer parses multipart fields
 * in order. The controller re-validates the final context and MIME type, so
 * sending `file` before `context` cannot bypass the per-context rules.
 */
function fileFilter(req, file, cb) {
  const context = req.query?.context ?? req.body?.context ?? "contribution";
  // Object.hasOwn avoids prototype keys like "__proto__"/"toString" being
  // treated as valid contexts and crashing on .includes().
  const allowed = Object.hasOwn(ALLOWED_TYPES, context)
    ? ALLOWED_TYPES[context]
    : ALLOWED_TYPES.contribution;

  if (!allowed.includes(file.mimetype)) {
    return cb(
      Object.assign(new Error(
        `File type "${file.mimetype}" is not allowed for context "${context}". ` +
        `Allowed: ${allowed.join(", ")}`
      ), { status: 415 }),
      false,
    );
  }
  cb(null, true);
}

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: MAX_BYTES,      // 10 MB hard limit — multer cuts the stream here
    files:    1,              // only one file per request
  },
  fileFilter,
}).single("file");            // field name must be "file"

/**
 * Validate `?context=` before multer reads the request body.
 * Body context is validated again in the controller.
 */
export function validateUploadContext(req, res, next) {
  const context = req.query?.context;
  if (context === undefined) return next();

  if (typeof context !== "string" || !VALID_CONTEXTS.includes(context)) {
    return res.status(400).json({
      message: `context must be one of: ${VALID_CONTEXTS.join(", ")}`,
    });
  }
  return next();
}

/**
 * Express middleware wrapper that converts multer callback-style errors into
 * proper JSON responses so they're consistent with the rest of the API.
 */
export function handleUpload(req, res, next) {
  uploadMiddleware(req, res, (err) => {
    if (!err) return next();

    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: `File too large. Maximum allowed size is ${MAX_BYTES / 1024 / 1024} MB.`,
      });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ message: "Only one file can be uploaded at a time." });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ message: 'File field must be named "file".' });
    }
    // fileFilter rejection (wrong MIME type)
    if (err.status === 415) {
      return res.status(415).json({ message: err.message });
    }
    // Any other multer limit (too many parts/fields, malformed multipart, …).
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: err.message });
    }

    return next(err);
  });
}
