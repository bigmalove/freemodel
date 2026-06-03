import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import setupRouter from "./setup.js";
import settingsRouter from "./settings.js";
import upstreamNodesRouter from "./upstreamNodes.js";
import verifyKeyRouter from "./verifyKey.js";
import ccTestRouter from "./ccTest.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(setupRouter);
router.use(settingsRouter);
router.use(upstreamNodesRouter);
router.use(verifyKeyRouter);
router.use(ccTestRouter);

export default router;

