import { v2 as cloudinary } from "cloudinary";
import config from "../../config.js";

// Configure explicitly from the validated values in config.js. Relying on the
// SDK's implicit CLOUDINARY_URL read made the failure mode depend on import
// order and produced a generic "Must supply api_key" at request time.
cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME,
  api_key: config.CLOUDINARY_API_KEY,
  api_secret: config.CLOUDINARY_API_SECRET,
  secure: true,
});

export default cloudinary;
