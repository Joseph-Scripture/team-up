import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { validate }     from "../middleware/validateResults.js";
import {
  createMilestoneRules,
  updateMilestoneRules,
  milestoneParamRules,
} from "../middleware/validateMilestone.js";
import {
  createTaskRules,
  listTasksRules,
  updateTaskRules,
  taskParamRules,
  createCommentRules,
  updateCommentRules,
  commentParamRules,
  createTeamUpdateRules,
} from "../middleware/validateTask.js";
import {
  CreateMilestone,
  ListMilestones,
  UpdateMilestone,
  DeleteMilestone,
} from "../controllers/milestoneController.js";
import {
  CreateTask,
  ListTasks,
  GetTask,
  UpdateTask,
  DeleteTask,
  CreateComment,
  ListComments,
  UpdateComment,
  DeleteComment,
  CreateTeamUpdate,
  ListTeamUpdates,
} from "../controllers/taskController.js";
import { param, query } from "express-validator";

// mergeParams: true so :projectId from the parent router is available here
const router = Router({ mergeParams: true });

router.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
// Milestones  →  /api/projects/:projectId/milestones
// ─────────────────────────────────────────────────────────────────────────────

router.post("/milestones",
  createMilestoneRules, validate, CreateMilestone);

router.get("/milestones",
  [param("projectId").isString().trim().notEmpty()], validate, ListMilestones);

router.patch("/milestones/:milestoneId",
  updateMilestoneRules, validate, UpdateMilestone);

router.delete("/milestones/:milestoneId",
  milestoneParamRules, validate, DeleteMilestone);

// ─────────────────────────────────────────────────────────────────────────────
// Tasks  →  /api/projects/:projectId/tasks
// ─────────────────────────────────────────────────────────────────────────────

router.post("/tasks",
  createTaskRules, validate, CreateTask);

router.get("/tasks",
  listTasksRules, validate, ListTasks);

// NOTE: /tasks/:taskId/comments must be declared BEFORE /tasks/:taskId so
// Express does not treat the literal "comments" as the taskId.
router.post("/tasks/:taskId/comments",
  createCommentRules, validate, CreateComment);

router.get("/tasks/:taskId/comments",
  taskParamRules, validate, ListComments);

router.patch("/tasks/:taskId/comments/:commentId",
  updateCommentRules, validate, UpdateComment);

router.delete("/tasks/:taskId/comments/:commentId",
  commentParamRules, validate, DeleteComment);

router.get("/tasks/:taskId",
  taskParamRules, validate, GetTask);

router.patch("/tasks/:taskId",
  updateTaskRules, validate, UpdateTask);

router.delete("/tasks/:taskId",
  taskParamRules, validate, DeleteTask);

// ─────────────────────────────────────────────────────────────────────────────
// Team Updates  →  /api/projects/:projectId/updates
// ─────────────────────────────────────────────────────────────────────────────

router.post("/updates",
  createTeamUpdateRules, validate, CreateTeamUpdate);

router.get("/updates", [
  param("projectId").isString().trim().notEmpty(),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 50 }).toInt(),
], validate, ListTeamUpdates);

export default router;
