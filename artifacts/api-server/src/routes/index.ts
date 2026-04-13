import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import organizationsRouter from "./organizations";
import facilitiesRouter from "./facilities";
import employeesRouter from "./employees";
import trainingTypesRouter from "./training-types";
import trainingRecordsRouter from "./training-records";
import practicumsRouter from "./practicums";
import alertsRouter from "./alerts";
import auditLogsRouter from "./audit-logs";
import usersRouter from "./users";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(organizationsRouter);
router.use(facilitiesRouter);
router.use(employeesRouter);
router.use(trainingTypesRouter);
router.use(trainingRecordsRouter);
router.use(practicumsRouter);
router.use(alertsRouter);
router.use(auditLogsRouter);
router.use(usersRouter);
router.use(dashboardRouter);
router.use(reportsRouter);

export default router;
