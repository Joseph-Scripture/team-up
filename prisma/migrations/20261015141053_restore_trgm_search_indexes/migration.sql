-- CreateIndex
CREATE INDEX "Project_title_trgm" ON "Project" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Skill_name_trgm" ON "Skill" USING GIN ("name" gin_trgm_ops);
