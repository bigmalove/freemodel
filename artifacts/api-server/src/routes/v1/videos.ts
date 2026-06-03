import { Router } from "express";
import { requireAuth } from "../../lib/auth.js";

const router = Router();

router.post("/v1/videos", requireAuth, (_req, res) => {
  res.status(501).json({
    error: {
      message: "Videos are not supported by this cc.freemodel.dev OpenAI relay.",
      type: "unsupported_endpoint",
    },
  });
});

router.get("/v1/videos/:id", requireAuth, (_req, res) => {
  res.status(501).json({
    error: {
      message: "Videos are not supported by this cc.freemodel.dev OpenAI relay.",
      type: "unsupported_endpoint",
    },
  });
});

export default router;
