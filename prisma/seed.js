import "dotenv/config"; // must be first: Prisma 7 does not load .env for you
import prisma from "../source/db/client.js";

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/\+/g, "-plus")   // "C++" -> "c-plus-plus"
    .replace(/#/g, "-sharp")   // "C#"  -> "c-sharp"
    .replace(/&/g, "-and-")    // "Data & AI" -> "data-and-ai"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// ─────────────────────────────────────────────────────────────────────────────
// Approved catalogue — Section 3 of TeamUp_Reusable_Skills_Profile_Specification v1.0
// Category names and skill names match the specification exactly.
// ─────────────────────────────────────────────────────────────────────────────
const catalogue = {
  "Product Management": [
    "Product Strategy",
    "User Stories & Acceptance Criteria",
    "Product Research",
    "Product Roadmapping",
  ],
  "Product Design (UI/UX)": [
    "UI Design",
    "UX Design",
    "Wireframing",
    "Prototyping",
    "User Research",
  ],
  "Business & Project Management": [
    "Business Requirements Analysis",
    "Process Mapping",
    "Agile Project Management",
    "Sprint Planning",
    "Task Management",
  ],
  "Software Development": [
    "Frontend Development",
    "Backend Development",
    "Full-Stack Development",
    "Mobile App Development",
    "API Development",
  ],
  "QA & Software Testing": [
    "Manual Testing",
    "Automated Testing",
    "API Testing",
    "Bug Reporting",
  ],
  "Data Analytics, Data Science & AI": [
    "SQL",
    "Excel & Spreadsheet Analysis",
    "Data Visualisation",
    "Machine Learning",
    "AI Application Development",
  ],
  "Cloud, DevOps & Cybersecurity": [
    "AWS",
    "Cloud Deployment",
    "Docker",
    "CI/CD Pipelines",
    "Application Security",
  ],
  "Digital Marketing & Content": [
    "Social Media Marketing",
    "SEO",
    "Content Marketing",
    "Copywriting",
    "Technical Documentation",
  ],
  "Graphic Design & Video Production": [
    "Graphic Design",
    "Brand Identity Design",
    "Social Media Design",
    "Video Editing",
    "Motion Graphics",
  ],
};

async function main() {
  const skills = Object.entries(catalogue).flatMap(([category, names]) =>
    names.map((name) => ({ name, slug: slugify(name), category }))
  );

  let created = 0;
  let updated = 0;

  for (const s of skills) {
    const result = await prisma.skill.upsert({
      where: { slug: s.slug },
      update: { name: s.name, category: s.category },
      create: s,
    });
    // upsert doesn't tell us which branch ran, so track via a separate query
    // (good enough for a seed script)
    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created++;
    } else {
      updated++;
    }
  }

  console.log(`Seeded ${skills.length} skills across ${Object.keys(catalogue).length} categories`);
  console.log(`  New: ${created}  |  Updated: ${updated}`);

  // Report any skills in the DB that are not in the new catalogue so the
  // operator can decide whether to remove them manually.
  const activeSlugs = new Set(skills.map((s) => s.slug));
  const orphaned = await prisma.skill.findMany({
    where: { slug: { notIn: [...activeSlugs] } },
    select: { id: true, name: true, slug: true, category: true },
  });

  if (orphaned.length > 0) {
    console.log(`\n⚠️  ${orphaned.length} skill(s) in the DB are NOT in the new catalogue.`);
    console.log("   They have NOT been deleted (they may be referenced by existing user/project data).");
    console.log("   Review and remove manually if safe:\n");
    orphaned.forEach((s) =>
      console.log(`   [${s.id}]  ${s.category} / ${s.name}  (slug: ${s.slug})`)
    );
  }
}

main()
  .catch((e) => {
    console.error("Seeding failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
