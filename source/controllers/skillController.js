import { matchedData } from "express-validator";
import * as skillService from "../services/skills.js";

export async function getSkills(req, res) {
  try {
    // Only fields covered by the validation rules get through.
    const filters = matchedData(req, { locations: ["query"] });
    const skills = await skillService.listSkills(filters);

    // The catalogue rarely changes, so let browsers reuse it for 5 minutes.
    res.set("Cache-Control", "public, max-age=300");
    return res.status(200).json({ skills });
  } catch (error) {
    console.error("getSkills failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getCategories(req, res) {
  try {
    const categories = await skillService.listCategories();
    res.set("Cache-Control", "public, max-age=300");
    return res.status(200).json({ categories });
  } catch (error) {
    console.error("getCategories failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
