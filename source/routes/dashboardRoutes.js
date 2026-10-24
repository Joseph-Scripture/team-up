import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { GetDashboard } from "../controllers/dashboardController.js";

const router = Router();

router.use(authenticate);

router.get("/", GetDashboard);

export default router;
