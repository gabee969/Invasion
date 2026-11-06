import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import gameRouter from "./game";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(gameRouter);

export default router;
