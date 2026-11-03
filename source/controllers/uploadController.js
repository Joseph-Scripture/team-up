import { matchedData } from "express-validator";
import { generateUploadSignature, UploadError } from "../services/uploadService.js";

function handleError(res, error) {
  if (error instanceof UploadError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error("upload operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

/**
 * @openapi
 * /api/uploads/sign:
 *   post:
 *     tags: [Uploads]
 *     summary: Generate a signed Cloudinary upload URL
 *     description: >
 *       Returns a signed upload URL so the client can upload a file directly to
 *       Cloudinary without the binary passing through this server. After the
 *       client uploads the file using the returned uploadUrl, it should send the
 *       returned fileUrl back with the task or contribution payload.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [filename, contentType]
 *             properties:
 *               filename:    { type: string }
 *               contentType: { type: string, example: "application/pdf" }
 *               context:
 *                 type: string
 *                 enum: [contribution, avatar, evidence]
 *                 default: contribution
 *     responses:
 *       200:
 *         description: Signed upload credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 uploadUrl: { type: string, description: "POST the file to this URL" }
 *                 fileUrl:   { type: string, description: "Permanent URL of the uploaded file — store this" }
 *                 publicId:  { type: string }
 *                 signature: { type: string }
 *                 timestamp: { type: integer }
 *                 apiKey:    { type: string }
 *                 folder:    { type: string }
 *                 maxBytes:  { type: integer }
 *       400: { description: Validation error }
 *       401: { description: Authentication required }
 */
export async function SignUpload(req, res) {
  try {
    const body   = matchedData(req, { locations: ["body"] });
    const result = await generateUploadSignature(body);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}
