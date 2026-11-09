import { uploadToCloudinary, UploadError } from "../services/uploadService.js";

function handleError(res, error) {
  if (error instanceof UploadError) {
    const log = error.status >= 500 ? console.error : console.warn;
    log("[upload] UploadError:", error.status, error.message);
    return res.status(error.status).json({ message: error.message });
  }
  console.error("[upload] Unexpected error:", error);
  return res.status(500).json({ message: "Internal server error" });
}

/**
 * @openapi
 * /api/uploads:
 *   post:
 *     tags: [Uploads]
 *     summary: Upload a file (server-side via multer → Cloudinary)
 *     description: >
 *       Accepts a multipart/form-data request with the file binary and context.
 *       The server validates the file type, size, and magic bytes, then uploads
 *       the file to Cloudinary and returns the permanent fileUrl in one step.
 *
 *       For profile pictures, send `context=avatar` and use the returned
 *       `fileUrl` as `avatarUrl` in PATCH /api/profile/users/me.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: context
 *         schema:
 *           type: string
 *           enum: [avatar, evidence, contribution]
 *           default: contribution
 *         description: >
 *           Upload context. Prefer sending this as a query parameter so it is
 *           available before multer parses the multipart body. The body field
 *           `context` is also accepted for backward compatibility.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The file binary to upload (max 10 MB)
 *               context:
 *                 type: string
 *                 enum: [avatar, evidence, contribution]
 *                 default: contribution
 *                 description: >
 *                   avatar — profile pictures (jpeg, png, webp, gif only);
 *                   evidence — project evidence (images + PDF);
 *                   contribution — task deliverables (images, PDF, docs, zip)
 *     responses:
 *       200:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 fileUrl:
 *                   type: string
 *                   description: Permanent Cloudinary URL — store and use this
 *                 publicId:
 *                   type: string
 *       400: { description: Missing file or invalid context }
 *       413: { description: File exceeds 10 MB limit }
 *       415: { description: File type not allowed for this context }
 *       401: { description: Authentication required }
 *       502: { description: Cloudinary upload failed }
 *       503: { description: Cloudinary is not configured on the server }
 */
export async function Upload(req, res) {
  try {
    console.log("[upload:controller] hit — user:", req.user?.id, "| query context:", req.query?.context, "| body context:", req.body?.context);

    if (!req.file) {
      console.warn("[upload:controller] no file on req — multer may not have parsed the body");
      return res.status(400).json({
        message: "No file provided. Send the file as multipart/form-data with field name \"file\".",
      });
    }

    console.log("[upload:controller] file received —", req.file.originalname, req.file.mimetype, req.file.size, "bytes");

    const context = req.query?.context ?? req.body?.context ?? "contribution";
    console.log("[upload:controller] resolved context:", context);

    const { fileUrl, publicId } = await uploadToCloudinary(
      req.file.buffer,
      req.file.mimetype,
      context,
    );

    console.log("[upload:controller] success — fileUrl:", fileUrl);
    return res.status(200).json({ fileUrl, publicId });
  } catch (error) {
    return handleError(res, error);
  }
}
