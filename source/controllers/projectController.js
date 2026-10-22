import {
  createDraft,
  updateDraft,
  publishProject,
  getProjectById,
  getProjectsByOwner,
  deleteProject,
  ProjectError,
} from "../services/projectService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared error handler
// ─────────────────────────────────────────────────────────────────────────────

function handleError(res, error) {
  if (error instanceof ProjectError) {
    return res.status(error.status).json({ message: error.message });
  }
  // Prisma unique constraint violation (e.g. slug collision on retry)
  if (error.code === "P2002") {
    return res.status(409).json({ message: "A project with that title already exists. Try a different name." });
  }
  console.error("project operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects
// Creates a new project draft. Returns 201 with the created project.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects:
 *   post:
 *     tags: [Projects]
 *     summary: Create a new project draft
 *     description: >
 *       Creates a project in DRAFT status. Only `title` is required — all other
 *       fields are optional so the wizard can persist an incomplete draft at any
 *       step. The authenticated user becomes the project owner and is
 *       automatically added as an ACTIVE OWNER member.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title:         { type: string, maxLength: 150 }
 *               problem:       { type: string }
 *               description:   { type: string }
 *               projectType:   { type: string, enum: [WEB_APPLICATION, MOBILE_APP, DESKTOP_APP, API_SERVICE, DATA_SCIENCE, DESIGN, OTHER] }
 *               outcome:       { type: string }
 *               teamSize:      { type: integer, minimum: 1 }
 *               durationWeeks: { type: integer, minimum: 1, maximum: 52 }
 *               startDate:     { type: string, format: date-time }
 *               targetEndDate: { type: string, format: date-time }
 *               availabilityExpectation:         { type: string }
 *               availabilityResponseExpectation: { type: string }
 *               skills:     { type: array, items: { type: object, properties: { skillId: { type: string }, minLevel: { type: string } } } }
 *               roles:      { type: array }
 *               milestones: { type: array }
 *     responses:
 *       201:
 *         description: Draft created
 *       400: { description: Validation error }
 *       401: { description: Authentication required }
 *       500: { description: Internal server error }
 */
export async function CreateDraft(req, res) {
  try {
    const project = await createDraft(req.user.id, req.body);
    return res.status(201).json({ message: "Draft created successfully", project });
  } catch (error) {
    return handleError(res, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/projects/:id
// Updates an existing draft. Returns 200 with the updated project.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{id}:
 *   put:
 *     tags: [Projects]
 *     summary: Update an existing draft
 *     description: >
 *       Partially or fully updates a DRAFT project. Only the owner can update.
 *       Skills, roles, and milestones are fully replaced when provided — send
 *       the complete desired state for those arrays. Fields omitted from the
 *       body are left unchanged.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Draft updated }
 *       400: { description: Validation error }
 *       401: { description: Authentication required }
 *       403: { description: Not the project owner }
 *       404: { description: Project not found }
 *       409: { description: Project is not a draft }
 *       500: { description: Internal server error }
 */
export async function UpdateDraft(req, res) {
  try {
    const project = await updateDraft(req.params.id, req.user.id, req.body);
    return res.status(200).json({ message: "Draft updated successfully", project });
  } catch (error) {
    return handleError(res, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:id/publish
// Validates completeness then transitions DRAFT → OPEN.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{id}/publish:
 *   post:
 *     tags: [Projects]
 *     summary: Publish a draft project
 *     description: >
 *       Validates that all required fields are present on the stored draft,
 *       then transitions status from DRAFT to OPEN and sets publishedAt.
 *       The request body must contain all required fields (same as publishRules).
 *       The service performs a final completeness check as a safety net.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Project published }
 *       400: { description: Project is incomplete — missing required fields }
 *       401: { description: Authentication required }
 *       403: { description: Not the project owner }
 *       404: { description: Project not found }
 *       409: { description: Project is not a draft }
 *       500: { description: Internal server error }
 */
export async function PublishProject(req, res) {
  try {
    // First persist any last-minute body data onto the draft, then publish.
    // This lets the final "Continue to commitment" step save + publish in one call.
    if (Object.keys(req.body).length > 0) {
      await updateDraft(req.params.id, req.user.id, req.body);
    }
    const project = await publishProject(req.params.id, req.user.id);
    return res.status(200).json({ message: "Project published successfully", project });
  } catch (error) {
    return handleError(res, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/mine
// Returns all projects (drafts + published) owned by the authenticated user.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/mine:
 *   get:
 *     tags: [Projects]
 *     summary: List the authenticated user's projects
 *     description: >
 *       Returns all non-deleted projects owned by the authenticated user,
 *       including DRAFT projects. Ordered newest first.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of projects
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 projects: { type: array }
 *       401: { description: Authentication required }
 *       500: { description: Internal server error }
 */
export async function GetMyProjects(req, res) {
  try {
    const projects = await getProjectsByOwner(req.user.id);
    return res.status(200).json({ projects });
  } catch (error) {
    return handleError(res, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:id
// Returns a single project. Drafts are only visible to the owner.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{id}:
 *   get:
 *     tags: [Projects]
 *     summary: Get a project by ID
 *     description: >
 *       Returns the project with its owner, skills, roles, and milestones.
 *       DRAFT projects are only visible to the owner. Published projects are
 *       visible to all authenticated users.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Project detail }
 *       401: { description: Authentication required }
 *       404: { description: Project not found }
 *       500: { description: Internal server error }
 */
export async function GetProject(req, res) {
  try {
    const project = await getProjectById(req.params.id, req.user.id);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }
    return res.status(200).json({ project });
  } catch (error) {
    return handleError(res, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/projects/:id
// Soft-deletes a project. Only the owner can delete.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{id}:
 *   delete:
 *     tags: [Projects]
 *     summary: Delete a project
 *     description: >
 *       Soft-deletes the project (sets deletedAt). The project disappears from
 *       all listings immediately. Only the owner can delete.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Project deleted }
 *       401: { description: Authentication required }
 *       403: { description: Not the project owner }
 *       404: { description: Project not found }
 *       500: { description: Internal server error }
 */
export async function DeleteProject(req, res) {
  try {
    const result = await deleteProject(req.params.id, req.user.id);
    return res.status(200).json({ message: "Project deleted successfully", project: result });
  } catch (error) {
    return handleError(res, error);
  }
}
