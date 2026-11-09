import { randomUUID } from "node:crypto";
import cloudinary from "../lib/cloudinary.js";
import config from "../../config.js";
import { detectMimeType, isMimeTypeCompatible } from "../lib/fileSignature.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Allowed upload contexts and the Cloudinary folder they map to.
const CONTEXT_FOLDERS = {
  contribution: "teamup/contributions",
  avatar:       "teamup/avatars",
  evidence:     "teamup/evidence",
};

export const VALID_CONTEXTS = Object.keys(CONTEXT_FOLDERS);

// Max file size enforced by multer (10 MB).
export const MAX_BYTES = 10 * 1024 * 1024;

// Allowed MIME types per context — shared with the multer middleware.
export const ALLOWED_TYPES = {
  avatar: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  evidence: [
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "application/pdf",
  ],
  contribution: [
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "application/pdf",
    "application/zip", "application/x-zip-compressed",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain", "text/markdown",
  ],
};

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
// Validation
// ─────────────────────────────────────────────────────────────────────────────

function assertValidUpload(buffer, mimetype, context) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new UploadError("File is empty", 400);
  }

  if (!VALID_CONTEXTS.includes(context)) {
    throw new UploadError(
      `context must be one of: ${VALID_CONTEXTS.join(", ")}`,
      400,
    );
  }

  const allowed = ALLOWED_TYPES[context];
  if (!allowed.includes(mimetype)) {
    throw new UploadError(
      `File type "${mimetype}" is not allowed for context "${context}". ` +
      `Allowed: ${allowed.join(", ")}`,
      415,
    );
  }

  const detected = detectMimeType(buffer);
  if (!isMimeTypeCompatible(mimetype, detected)) {
    throw new UploadError(
      `The file contents do not match the declared type "${mimetype}".`,
      415,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// uploadToCloudinary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload a file buffer directly to Cloudinary.
 *
 * Single-request flow:
 *   POST /api/uploads?context=avatar  (multipart/form-data)
 *     fields: file (binary), optional context
 *   → server validates type + size + magic bytes → uploads to Cloudinary
 *   → returns { fileUrl, publicId }
 *
 * @param {Buffer} buffer   — file buffer from multer memoryStorage
 * @param {string} mimetype — MIME type reported by multer
 * @param {string} context  — "avatar" | "evidence" | "contribution"
 * @returns {Promise<{ fileUrl: string, publicId: string }>}
 */
export async function uploadToCloudinary(buffer, mimetype, context = "contribution") {
  assertValidUpload(buffer, mimetype, context);

  const cloudinaryConfig = cloudinary.config();
  if (!cloudinaryConfig.cloud_name || !cloudinaryConfig.api_key || !cloudinaryConfig.api_secret) {
    throw new UploadError("Cloudinary is not configured on the server", 503);
  }

  const folder = CONTEXT_FOLDERS[context];
  const resourceType = mimetype.startsWith("image/") ? "image" : "raw";
  // Cloudinary appends image extensions itself. Raw files are stored without
  // an extension: appending ".pdf"/".zip" makes Cloudinary apply its PDF/ZIP
  // delivery policy, which returns 401 on accounts that disable those formats.
  const publicId = `${Date.now()}-${randomUUID()}`;
  const dataUri = `data:${mimetype};base64,${buffer.toString("base64")}`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder,
      public_id:     publicId,
      resource_type: resourceType,
    });
    return { fileUrl: result.secure_url, publicId: result.public_id };
  } catch (error) {
    // Keep the response generic but log the real reason (bad credentials,
    // Cloudinary outage, rejected file, etc.) so it is diagnosable.
    console.error("[cloudinary] upload failed:", error);
    const status = error?.http_code === 400 ? 400 : 502;
    throw new UploadError(
      status === 400 ? "Cloudinary rejected the file" : "Cloudinary upload failed",
      status,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteCloudinaryAsset
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Best-effort deletion of a previously uploaded Cloudinary asset.
 * Used when a user replaces or clears their avatar.
 *
 * Only URLs belonging to this application's Cloudinary cloud are touched.
 */
export async function deleteCloudinaryAsset(fileUrl) {
  if (!fileUrl || typeof fileUrl !== "string") return;

  let url;
  try {
    url = new URL(fileUrl);
  } catch {
    return;
  }

  if (url.hostname !== "res.cloudinary.com") return;

  const parts = url.pathname.split("/").filter(Boolean);
  // /<cloud_name>/<resource_type>/<delivery_type>/...
  if (parts[0] !== config.CLOUDINARY_CLOUD_NAME) return;
  if (!["image", "raw", "video"].includes(parts[1])) return;
  if (parts[2] !== "upload") return;

  let rest = parts.slice(3);
  if (rest[0]?.startsWith("v") && /^\d+$/.test(rest[0].slice(1))) {
    rest = rest.slice(1);
  }
  if (rest.length === 0) return;

  const publicId = rest.join("/").replace(/\.[^.]+$/, "");

  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: parts[1] });
  } catch (error) {
    console.warn("[cloudinary] failed to delete old asset:", error?.message ?? error);
  }
}
