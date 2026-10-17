import prisma from "../db/client.js";

export async function listSkills(_req, res) {
  try {
    const skills = await prisma.skill.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    return res.status(200).json({ skills });
  } catch (error) {
    console.error("listSkills failed:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
