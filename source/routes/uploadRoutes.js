import { Router } from "express";
import { authenticate }   from "../middleware/authenticate.js";
import { validate }       from "../middleware/validateResults.js";
import { signUploadRules } from "../middleware/validateUpload.js";
import { SignUpload }      from "../controllers/uploadController.js";

const router = Router();

router.use(authenticate);

/**
 * POST /api/uploads/sign
 * Generate a signed Cloudinary upload URL.
 */
router.post("/sign", signUploadRules, validate, SignUpload);

export default router;
