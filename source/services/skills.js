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

// Returns the distinct, sorted list of category names from the catalogue.
// Null categories are excluded — every spec skill has a category.
export async function listCategories() {
  const rows = await prisma.skill.findMany({
    where: { category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category);
}
