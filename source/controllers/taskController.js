import { matchedData } from "express-validator";
import {
  createTask,
  listTasks,
  getTask,
  updateTask,
  deleteTask,
  createComment,
  listComments,
  updateComment,
  deleteComment,
  TaskError,
} from "../services/taskService.js";
import {
  createTeamUpdate,
  listTeamUpdates,
  TeamUpdateError,
} from "../services/teamUpdateService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared error handler
// ─────────────────────────────────────────────────────────────────────────────

function handleError(res, error) {
  if (error instanceof TaskError || error instanceof TeamUpdateError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error("task operation failed:", error);
  return res.status(500).json({ message: "Internal server error" });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/tasks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/tasks:
 *   post:
 *     tags: [Tasks]
 *     summary: Create a task on a project
 *     description: >
 *       Owner / Manager only. assigneeMemberId must be the ProjectMember.id of an
 *       active member — get it from GET /api/projects/:id (memberships[].id).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, assigneeMemberId, dueDate, milestoneId]
 *             properties:
 *               title:            { type: string, maxLength: 200 }
 *               assigneeMemberId: { type: string, description: "ProjectMember.id (not userId)" }
 *               dueDate:          { type: string, format: date-time }
 *               milestoneId:      { type: string }
 *               description:      { type: string }
 *               status:
 *                 type: string
 *                 enum: [TODO, IN_PROGRESS, BLOCKED, IN_REVIEW, COMPLETED, CANCELLED]
 *                 default: TODO
 *               priority:
 *                 type: string
 *                 enum: [LOW, MEDIUM, HIGH, URGENT]
 *                 default: MEDIUM
 *               estimatedHours:   { type: integer, minimum: 1 }
 *               sortOrder:        { type: integer, minimum: 0, default: 0 }
 *     responses:
 *       201: { description: Task created, assignee notified }
 *       400: { description: Validation error or invalid assignee }
 *       403: { description: Not permitted }
 *       404: { description: Project or milestone not found }
 */
export async function CreateTask(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const body          = matchedData(req, { locations: ["body"] });
    const task          = await createTask(req.userId, projectId, body);
    return res.status(201).json({ task });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/tasks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/tasks:
 *   get:
 *     tags: [Tasks]
 *     summary: List all tasks for a project
 *     description: >
 *       Any active project member can call this. Returns a summary object
 *       (total, done, notDone, overdue) for the progress bar alongside the
 *       paginated task list. Use ?mine=true to filter to only your assigned tasks.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [TODO, IN_PROGRESS, BLOCKED, IN_REVIEW, COMPLETED, CANCELLED]
 *       - in: query
 *         name: milestoneId
 *         schema: { type: string }
 *       - in: query
 *         name: assigneeMemberId
 *         schema: { type: string }
 *       - in: query
 *         name: mine
 *         schema: { type: boolean, default: false }
 *         description: When true, returns only tasks assigned to the authenticated user
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 50 }
 *     responses:
 *       200:
 *         description: Tasks with progress summary and pagination
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:   { type: integer }
 *                     done:    { type: integer }
 *                     notDone: { type: integer }
 *                     overdue: { type: integer }
 *                 tasks:      { type: array }
 *                 pagination: { type: object }
 *       404: { description: Project not found }
 */
export async function ListTasks(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const filters       = matchedData(req, { locations: ["query"] });
    const result        = await listTasks(req.userId, projectId, filters);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/tasks/:taskId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/tasks/{taskId}:
 *   get:
 *     tags: [Tasks]
 *     summary: Get full detail of a single task
 *     description: Includes milestone, assignee, createdBy, and contributions with evidence.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Full task detail }
 *       404: { description: Project or task not found }
 */
export async function GetTask(req, res) {
  try {
    const { projectId, taskId } = matchedData(req, { locations: ["params"] });
    const task = await getTask(req.userId, projectId, taskId);
    return res.status(200).json({ task });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/:projectId/tasks/:taskId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/tasks/{taskId}:
 *   patch:
 *     tags: [Tasks]
 *     summary: Update a task
 *     description: >
 *       **Owner / Manager** — can update all fields including title, assignee,
 *       milestone, priority, and due date.
 *
 *       **Assignee (Member)** — can only update status, blockerNote, and the
 *       contribution block. Attempting to send other fields returns 403.
 *
 *       **Status rules:**
 *       - BLOCKED requires a non-empty blockerNote
 *       - Moving away from BLOCKED clears blockerNote automatically
 *       - COMPLETED sets completedAt and optionally creates a Contribution
 *       - IN_PROGRESS sets startedAt on first transition
 *
 *       **Contribution block** (optional, only meaningful when status = COMPLETED):
 *       Include a `contribution` object to record what was delivered. If a file
 *       was uploaded via POST /api/uploads/sign, pass the returned fileUrl here.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:            { type: string, maxLength: 200 }
 *               description:      { type: string }
 *               assigneeMemberId: { type: string }
 *               milestoneId:      { type: string }
 *               dueDate:          { type: string, format: date-time }
 *               status:
 *                 type: string
 *                 enum: [TODO, IN_PROGRESS, BLOCKED, IN_REVIEW, COMPLETED, CANCELLED]
 *               priority:
 *                 type: string
 *                 enum: [LOW, MEDIUM, HIGH, URGENT]
 *               blockerNote:      { type: string, maxLength: 1000, description: "Required when status = BLOCKED" }
 *               estimatedHours:   { type: integer, minimum: 1 }
 *               sortOrder:        { type: integer, minimum: 0 }
 *               contribution:
 *                 type: object
 *                 description: "Content card — only processed when status = COMPLETED"
 *                 properties:
 *                   title:          { type: string, maxLength: 200 }
 *                   completionNote: { type: string, maxLength: 2000 }
 *                   artifactUrl:    { type: string, format: uri, description: "Link to Figma, GitHub, live demo, etc." }
 *                   fileUrl:        { type: string, format: uri, description: "Cloudinary fileUrl returned by POST /api/uploads/sign" }
 *                   fileType:
 *                     type: string
 *                     enum: [REPOSITORY, LIVE_DEMO, DOCUMENT, IMAGE, VIDEO, OTHER]
 *     responses:
 *       200:
 *         description: Updated task and optional contribution
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 task:         { type: object }
 *                 contribution: { type: object, nullable: true }
 *       400: { description: Validation error or missing blockerNote }
 *       403: { description: Not assignee or owner/manager }
 *       404: { description: Task not found }
 */
export async function UpdateTask(req, res) {
  try {
    const { projectId, taskId } = matchedData(req, { locations: ["params"] });
    const body = matchedData(req, { locations: ["body"] });
    const result = await updateTask(req.userId, projectId, taskId, body);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/projects/:projectId/tasks/:taskId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/tasks/{taskId}:
 *   delete:
 *     tags: [Tasks]
 *     summary: Delete a task
 *     description: Owner / Manager only. Cascades to comments and contributions.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Task deleted }
 *       403: { description: Not permitted }
 *       404: { description: Task not found }
 */
export async function DeleteTask(req, res) {
  try {
    const { projectId, taskId } = matchedData(req, { locations: ["params"] });
    const result = await deleteTask(req.userId, projectId, taskId);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/tasks/:taskId/comments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/tasks/{taskId}/comments:
 *   post:
 *     tags: [Tasks]
 *     summary: Post a comment on a task
 *     description: Any active project member can comment. The task assignee is notified.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string, maxLength: 3000 }
 *     responses:
 *       201: { description: Comment created }
 *       404: { description: Task not found }
 */
export async function CreateComment(req, res) {
  try {
    const { projectId, taskId } = matchedData(req, { locations: ["params"] });
    const body    = matchedData(req, { locations: ["body"] });
    const comment = await createComment(req.userId, projectId, taskId, body);
    return res.status(201).json({ comment });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/tasks/:taskId/comments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/tasks/{taskId}/comments:
 *   get:
 *     tags: [Tasks]
 *     summary: List comments on a task
 *     description: Returns non-deleted comments ordered oldest first.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Array of comments }
 *       404: { description: Task not found }
 */
export async function ListComments(req, res) {
  try {
    const { projectId, taskId } = matchedData(req, { locations: ["params"] });
    const comments = await listComments(req.userId, projectId, taskId);
    return res.status(200).json({ comments });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/:projectId/tasks/:taskId/comments/:commentId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/tasks/{taskId}/comments/{commentId}:
 *   patch:
 *     tags: [Tasks]
 *     summary: Edit a comment
 *     description: Author only. Sets editedAt to the current timestamp.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string, maxLength: 3000 }
 *     responses:
 *       200: { description: Updated comment }
 *       403: { description: Not the comment author }
 *       404: { description: Comment not found }
 */
export async function UpdateComment(req, res) {
  try {
    const { projectId, taskId, commentId } = matchedData(req, { locations: ["params"] });
    const body    = matchedData(req, { locations: ["body"] });
    const comment = await updateComment(req.userId, projectId, taskId, commentId, body);
    return res.status(200).json({ comment });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/projects/:projectId/tasks/:taskId/comments/:commentId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/tasks/{taskId}/comments/{commentId}:
 *   delete:
 *     tags: [Tasks]
 *     summary: Delete a comment (soft delete)
 *     description: Author, Owner, or Manager can delete. The row is kept but hidden from list responses.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Comment deleted }
 *       403: { description: Not permitted }
 *       404: { description: Comment not found }
 */
export async function DeleteComment(req, res) {
  try {
    const { projectId, taskId, commentId } = matchedData(req, { locations: ["params"] });
    const result = await deleteComment(req.userId, projectId, taskId, commentId);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/:projectId/updates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/updates:
 *   post:
 *     tags: [TeamUpdates]
 *     summary: Post a team update
 *     description: Any active project member can post an update to the project thread.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string, maxLength: 5000 }
 *     responses:
 *       201: { description: Update posted }
 *       404: { description: Project not found }
 */
export async function CreateTeamUpdate(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const body   = matchedData(req, { locations: ["body"] });
    const update = await createTeamUpdate(req.userId, projectId, body);
    return res.status(201).json({ update });
  } catch (err) {
    return handleError(res, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/projects/:projectId/updates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/projects/{projectId}/updates:
 *   get:
 *     tags: [TeamUpdates]
 *     summary: List team updates for a project
 *     description: Paginated, newest first. Any active project member can read.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of team updates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 updates:    { type: array }
 *                 pagination: { type: object }
 *       404: { description: Project not found }
 */
export async function ListTeamUpdates(req, res) {
  try {
    const { projectId } = matchedData(req, { locations: ["params"] });
    const filters = matchedData(req, { locations: ["query"] });
    const result  = await listTeamUpdates(req.userId, projectId, filters);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}
