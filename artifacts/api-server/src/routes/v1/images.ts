import { Router } from "express";
import { requireAuth } from "../../lib/auth.js";

const router = Router();

router.post("/v1/images/generations", requireAuth, (_req, res) => {
  res.status(501).json({
    error: {
      message: "Images are not supported by this cc.freemodel.dev OpenAI relay.",
      type: "unsupported_endpoint",
    },
  });
});

export default router;
