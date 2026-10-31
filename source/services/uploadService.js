import cloudinary from "../lib/cloudinary.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// How long (seconds) a signed upload URL remains valid.
const UPLOAD_TTL_SECONDS = 300; // 5 minutes

// Allowed upload contexts and the Cloudinary folder they map to.
const CONTEXT_FOLDERS = {
  contribution: "teamup/contributions",
  avatar:       "teamup/avatars",
  evidence:     "teamup/evidence",
};

// Max file size we will allow (10 MB). Cloudinary enforces this on their end
// when we include it in the signature params.
const MAX_BYTES = 10 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Custom error
// ─────────────────────────────────────────────────────────────────────────────

export class UploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = "UploadError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// generateUploadSignature
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a signed Cloudinary upload URL so the frontend can upload directly
 * to Cloudinary without the binary ever touching our server.
 *
 * Flow:
 *   1. Client calls POST /api/uploads/sign
 *   2. Server returns { uploadUrl, publicId, fileUrl, signature, ... }
 *   3. Client POSTs the file directly to Cloudinary using uploadUrl
 *   4. Client sends the returned fileUrl back with the task/contribution payload
 *
 * @param {object} opts
 * @param {string}  opts.filename     — original filename, used to build publicId
 * @param {string}  opts.contentType  — MIME type (e.g. "image/png", "application/pdf")
 * @param {string}  [opts.context="contribution"]  — scopes the Cloudinary folder
 * @returns {{ uploadUrl, publicId, fileUrl, signature, timestamp, apiKey, folder }}
 */
export async function generateUploadSignature({ filename, contentType, context = "contribution" }) {
  if (!filename || typeof filename !== "string" || filename.trim().length === 0) {
    throw new UploadError("filename is required");
  }
  if (!contentType || typeof contentType !== "string") {
    throw new UploadError("contentType is required");
  }

  const folder = CONTEXT_FOLDERS[context] ?? CONTEXT_FOLDERS.contribution;

  // Sanitise filename: strip path separators, replace spaces with dashes,
  // strip the extension (Cloudinary appends it from the content type).
  const safeName = filename
    .replace(/[/\\]/g, "")
    .replace(/\s+/g, "-")
    .replace(/\.[^.]+$/, "")          // strip extension
    .slice(0, 100);                   // cap length

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId  = `${folder}/${Date.now()}-${safeName}`;

  // Parameters that will be signed. Must match exactly what the frontend
  // sends when it POSTs to Cloudinary — any extra/missing param will fail.
  const paramsToSign = {
    folder,
    public_id:    publicId,
    timestamp,
    max_file_size: MAX_BYTES,
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    cloudinary.config().api_secret,
  );

  // The direct upload endpoint. Frontend POSTs the file as multipart/form-data
  // to this URL, including all the signed params below.
  const cloudName = cloudinary.config().cloud_name;
  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;

  // The permanent URL where the file will be accessible after upload.
  // We return this so the client can store it immediately after upload succeeds.
  const fileUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${publicId}`;

  return {
    uploadUrl,
    publicId,
    fileUrl,
    signature,
    timestamp,
    apiKey:    cloudinary.config().api_key,
    folder,
    maxBytes:  MAX_BYTES,
  };
}
