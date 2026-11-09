import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { handleUpload, validateUploadContext } from "../middleware/multerUpload.js";
import { Upload } from "../controllers/uploadController.js";
import { uploadLimiter } from "../middleware/ratelimiter.js";

const router = Router();

// All upload routes require authentication.
router.use(authenticate);

/**
 * POST /api/uploads
 * Single-step upload: multer validates type + size, the server uploads to
 * Cloudinary and returns { fileUrl, publicId }. Use fileUrl directly in
 * avatarUrl / contribution.fileUrl.
 *
 * Send context as a query parameter (preferred) or as a multipart field:
 *   POST /api/uploads?context=avatar
 */
router.post("/", uploadLimiter, validateUploadContext, handleUpload, Upload);

export default router;
