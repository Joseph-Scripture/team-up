import { matchedData } from "express-validator";
import * as skillService from "../services/skills.js";
import { sendServerError } from "../lib/dbErrors.js";

export async function getSkills(req, res) {
  try {
    // Only fields covered by the validation rules get through.
    const filters = matchedData(req, { locations: ["query"] });
    const skills = await skillService.listSkills(filters);

    // The catalogue rarely changes, so let browsers reuse it for 5 minutes.
    res.set("Cache-Control", "public, max-age=300");
    return res.status(200).json({ skills });
  } catch (error) {
    return sendServerError(res, error, "getSkills failed");
  }
}

export async function getCategories(req, res) {
  try {
    const categories = await skillService.listCategories();
    res.set("Cache-Control", "public, max-age=300");
    return res.status(200).json({ categories });
  } catch (error) {
    return sendServerError(res, error, "getCategories failed");
  }
}
