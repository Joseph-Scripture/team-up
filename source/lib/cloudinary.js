import { v2 as cloudinary } from "cloudinary";

// Cloudinary is configured automatically from the CLOUDINARY_URL env variable.
// No explicit config call is needed — the SDK reads it on import.
// We export the configured instance so every module shares the same client.

export default cloudinary;
