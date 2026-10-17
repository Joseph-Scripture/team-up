import "dotenv/config"; // must be first: Prisma 7 does not load .env for you
import prisma from "../source/db/client.js";

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/\+/g, "-plus")   // "C++" -> "c-plus-plus"
    .replace(/#/g, "-sharp")   // "C#"  -> "c-sharp"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const catalogue = {
  Frontend: ["HTML", "CSS", "JavaScript", "TypeScript", "React", "Next.js", "Vue.js", "Tailwind CSS"],
  Backend: ["Node.js", "Express", "NestJS", "Python", "Django", "FastAPI", "Java", "Spring Boot", "C#", "PHP", "Laravel", "Go"],
  Database: ["PostgreSQL", "MySQL", "MongoDB", "Redis", "Prisma", "SQL"],
  "Data & AI": ["Machine Learning", "Deep Learning", "NLP", "Data Analysis", "Pandas", "PyTorch", "TensorFlow", "Data Visualization"],
  Mobile: ["React Native", "Flutter", "Kotlin", "Swift"],
  "DevOps & Cloud": ["Docker", "Git", "CI/CD", "AWS", "Linux", "Kubernetes"],
  Design: ["UI/UX Design", "Figma", "Graphic Design", "Prototyping", "User Research"],
  "Product & Management": ["Project Management", "Product Management", "Agile/Scrum", "Technical Writing", "Marketing", "QA & Testing"],
};

async function main() {
  const skills = Object.entries(catalogue).flatMap(([category, names]) =>
    names.map((name) => ({ name, slug: slugify(name), category }))
  );

  for (const s of skills) {
    await prisma.skill.upsert({
      where: { slug: s.slug },
      update: { name: s.name, category: s.category },
      create: s,
    });
  }
  console.log(`Seeded ${skills.length} skills`);
}

main()
  .catch((e) => {
    console.error("Seeding failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect()); // without this the process hangs on the connection pool