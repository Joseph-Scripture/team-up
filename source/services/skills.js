import prisma from "../db/client.js";

// Optional filters: q matches part of the name, category matches the exact category (both case-insensitive).
export async function listSkills({ q, category } = {}) {
  return prisma.skill.findMany({
    where: {
      ...(category && { category: { equals: category, mode: "insensitive" } }),
      ...(q && { name: { contains: q, mode: "insensitive" } }),
    },
    select: { id: true, name: true, slug: true, category: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}
