import { matchedData } from "express-validator";
import * as profileService from "../services/userProfile.js";

function handleError(res, error, label) {
  if (error instanceof profileService.HttpError) {
    return res.status(error.status).json({ message: error.message });
  }
  if (error.code === "P2025") {
    return res.status(404).json({ message: "User not found" });
  }
  console.error(`${label} failed:`, error);
  return res.status(500).json({ message: "Internal server error" });
}

export async function getMe(req, res) {
  try {
    const user = await profileService.getProfile(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.status(200).json({ user });
  } catch (error) {
    return handleError(res, error, "getMe");
  }
}

export async function completeOnboarding(req, res) {
  try {
    const data = matchedData(req, { locations: ["body"] });
    const user = await profileService.completeOnboarding(req.user.id, data);
    return res.status(200).json({ message: "Profile saved", user });
  } catch (error) {
    return handleError(res, error, "completeOnboarding");
  }
}

export async function updateProfile(req, res) {
  try {
    const data = matchedData(req, { locations: ["body"] });
    const user = await profileService.updateProfile(req.user.id, data);
    return res.status(200).json({ message: "Profile updated", user });
  } catch (error) {
    return handleError(res, error, "updateProfile");
export async function deleteAccount(req, res) {
  try {
    await profileService.deleteUserProfile(req.user.id);
    return res.status(200).json({ message: "Account deleted successfully" });
  } catch (error) {
    return handleError(res, error, "deleteAccount");
  }
}