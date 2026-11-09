// Lightweight magic-byte detection for the file types this API accepts.
// We deliberately avoid trusting the client-supplied MIME type: multer's
// file.mimetype is just the Content-Type header sent by the browser.

const ZIP_MIME = "application/zip";
const OLE_MIME = "application/x-ole-storage";

const ZIP_DECLARED = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const OLE_DECLARED = new Set([
  "application/msword",
  "application/vnd.ms-excel",
]);

const TEXT_DECLARED = new Set(["text/plain", "text/markdown"]);

function startsWith(buffer, bytes, offset = 0) {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function ascii(buffer, start, end) {
  return buffer.subarray(start, end).toString("ascii");
}

/**
 * Detect a file's real type from its leading bytes.
 * Returns null when the type has no reliable signature (e.g. plain text).
 */
export function detectMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (ascii(buffer, 0, 6) === "GIF87a" || ascii(buffer, 0, 6) === "GIF89a") {
    return "image/gif";
  }
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (ascii(buffer, 0, 5) === "%PDF-") return "application/pdf";
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    // ZIP local file header, empty archive, or spanned archive.
    if ([0x03, 0x05, 0x07].includes(buffer[2])) return ZIP_MIME;
  }
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return OLE_MIME;
  }

  return null;
}

/**
 * Check that the declared MIME type is compatible with the bytes on disk.
 * This prevents a PDF (or any other file) from being uploaded as an avatar
 * simply by spoofing the multipart Content-Type.
 */
export function isMimeTypeCompatible(declaredMime, detectedMime) {
  if (typeof declaredMime !== "string") return false;

  if (declaredMime.startsWith("image/")) {
    return declaredMime === detectedMime;
  }

  if (declaredMime === "application/pdf") {
    return detectedMime === "application/pdf";
  }

  if (ZIP_DECLARED.has(declaredMime)) {
    return detectedMime === ZIP_MIME;
  }

  if (OLE_DECLARED.has(declaredMime)) {
    return detectedMime === OLE_MIME;
  }

  if (TEXT_DECLARED.has(declaredMime)) {
    // Text has no signature; reject anything that looks like a binary format.
    return detectedMime === null;
  }

  return false;
}
