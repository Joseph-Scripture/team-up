import { matchedData } from "express-validator";
import {
  createDraft,
  updateDraft,
  publishProject,
  getProjectById,
  getProjectsByOwner,
  deleteProject,
  searchProjects,
  setProjectSharing,
  completeProject,
  ProjectError,
} from "../services/projectService.js";
import {
  getProjectTeamHealth,
  getTeamHealthForProjects,
} from "../services/teamHealthService.js";

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
 *       Validates that all required fields are present, then transitions status
 *       from DRAFT to OPEN and sets publishedAt. The body may be omitted or
 *       empty to publish the already-saved draft; when fields are provided
 *       (same as publishRules), the draft is updated first. The service performs
 *       a final completeness check as a safety net.
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
    // An omitted body leaves req.body undefined, while `{}` is an empty object.
    // Both mean "publish the draft as saved" — only update when data was sent.
    if (req.body && Object.keys(req.body).length > 0) {
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

    // One team-health status per project, shown on My Projects.
    const healthMap = await getTeamHealthForProjects(projects);

    return res.status(200).json({
      projects: projects.map((p) => ({ ...p, teamHealth: healthMap.get(p.id) ?? null })),
    });
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

    // Team health is private to the team — it is null for everybody else.
    const teamHealth = await getProjectTeamHealth(project.id, req.user.id);

    return res.status(200).json({ project: { ...project, teamHealth } });
  } catch (error) {
    return handleError(res, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/health
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/health:
 *   get:
 *     tags: [Projects]
 *     summary: Get the team health of a project
 *     description: >
 *       ONE status for the whole team — never a score for an individual.
 *       ON_TRACK (nothing wrong), NEEDS_ATTENTION (an overdue task, a blocked
 *       task or a missed weekly check-in) or AT_RISK (an overdue milestone or a
 *       member inactive for more than 14 days). When more than one condition
 *       applies, the most serious one wins. Only team members can read it.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: The team health of the project }
 *       404: { description: Project not found or not a team member }
 */
export async function GetProjectHealth(req, res) {
  try {
    const teamHealth = await getProjectTeamHealth(req.params.projectId, req.user.id);
    if (!teamHealth) {
      return res.status(404).json({ message: "Project not found" });
    }
    return res.status(200).json({ teamHealth });
  } catch (error) {
    return handleError(res, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:id/complete
// Only the owner can complete a project.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{id}/complete:
 *   post:
 *     tags: [Projects]
 *     summary: Complete the project
 *     description: >
 *       Only the project owner can complete a project. The server validates
 *       every requirement: the owner must enter a final outcome, the project
 *       must have at least one deliverable, every active member must have a
 *       confirmed contribution (the member reviews their own summary, a
 *       teammate confirms it), no contribution may still be waiting for a
 *       review, and no task may still be open.
 *
 *       When a requirement is not met the response is 409 with a `checks` array
 *       listing everything that is still missing.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [outcome]
 *             properties:
 *               outcome:
 *                 type: string
 *                 maxLength: 5000
 *                 description: The final outcome of the project
 *     responses:
 *       200: { description: Project completed }
 *       400: { description: The final outcome is missing }
 *       403: { description: Not the project owner }
 *       404: { description: Project not found }
 *       409:
 *         description: The project is not ready to be completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *                 checks:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code:    { type: string }
 *                       message: { type: string }
 */
export async function CompleteProject(req, res) {
  try {
    const { outcome } = matchedData(req, { locations: ["body"] });
    const project = await completeProject(req.params.id, req.user.id, outcome);
    return res.status(200).json({ message: "Project completed successfully", project });
  } catch (error) {
    if (error instanceof ProjectError && error.checks) {
      return res.status(error.status).json({ message: error.message, checks: error.checks });
    }
    return handleError(res, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:id/share  &  POST /api/projects/:id/unshare
// The project page is private to the team until the owner shares it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{id}/share:
 *   post:
 *     tags: [Projects]
 *     summary: Share the project page
 *     description: >
 *       Only the owner can share or unshare a project. A shared project page is
 *       visible to every authenticated user and appears in Discover and in
 *       recommendations. An unshared project page is private to the team
 *       (owner + active members) and disappears from the public listings.
 *       Publishing a draft shares it automatically.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Project shared }
 *       403: { description: Not the project owner }
 *       404: { description: Project not found }
 */
export async function ShareProject(req, res) {
  try {
    const project = await setProjectSharing(req.params.id, req.user.id, true);
    return res.status(200).json({ message: "Project shared successfully", project });
  } catch (error) {
    return handleError(res, error);
  }
}

/**
 * @openapi
 * /api/projects/{id}/unshare:
 *   post:
 *     tags: [Projects]
 *     summary: Make the project page private to the team
 *     description: >
 *       Only the owner can share or unshare a project. Unsharing hides the
 *       project page from everybody except the owner and the active members,
 *       and removes it from Discover and recommendations. Members who already
 *       joined keep full access.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Project unshared }
 *       403: { description: Not the project owner }
 *       404: { description: Project not found }
 */
export async function UnshareProject(req, res) {
  try {
    const project = await setProjectSharing(req.params.id, req.user.id, false);
    return res.status(200).json({ message: "Project is now private to the team", project });
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects
// Browse / search published OPEN projects (Discover Projects screen).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects:
 *   get:
 *     tags: [Projects]
 *     summary: Browse and search published projects
 *     description: >
 *       Returns paginated OPEN projects for the Discover Projects screen.
 *       All filter parameters are optional — omit them to browse all open projects.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string, maxLength: 100 }
 *         description: Case-insensitive search on project title and description
 *       - in: query
 *         name: projectType
 *         schema:
 *           type: string
 *           enum: [WEB_APPLICATION, MOBILE_APP, DESKTOP_APP, API_SERVICE, DATA_SCIENCE, DESIGN, OTHER]
 *       - in: query
 *         name: skillIds
 *         style: form
 *         explode: true
 *         schema: { type: array, items: { type: string } }
 *         description: Filter to projects that require at least one of these skill IDs
 *       - in: query
 *         name: minDuration
 *         schema: { type: integer, minimum: 1 }
 *         description: Minimum project duration in weeks
 *       - in: query
 *         name: maxDuration
 *         schema: { type: integer, minimum: 1 }
 *         description: Maximum project duration in weeks
 *       - in: query
 *         name: minHours
 *         schema: { type: integer, minimum: 0 }
 *         description: Minimum weekly hours commitment
 *       - in: query
 *         name: maxHours
 *         schema: { type: integer, minimum: 0 }
 *         description: Maximum weekly hours commitment
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 12 }
 *     responses:
 *       200:
 *         description: Paginated project list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 projects:   { type: array }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:      { type: integer }
 *                     page:       { type: integer }
 *                     limit:      { type: integer }
 *                     totalPages: { type: integer }
 *       401: { description: Authentication required }
 */
export async function SearchProjects(req, res) {
  try {
    const {
      q, projectType,
      minDuration, maxDuration,
      minHours, maxHours,
      roleTitle, page, limit,
    } = req.query;

    // skillIds can arrive as ?skillIds[]=x&skillIds[]=y or ?skillIds=x
    const skillIds = req.query["skillIds[]"] ?? req.query.skillIds;
    const skillIdsArr = skillIds
      ? (Array.isArray(skillIds) ? skillIds : [skillIds]).filter(Boolean)
      : [];

    const result = await searchProjects(
      req.user.id,
      { q, projectType, skillIds: skillIdsArr, minDuration, maxDuration, minHours, maxHours, roleTitle },
      { page, limit },
    );

    return res.status(200).json(result);
  } catch (error) {
    return handleError(res, error);
  }
}
