import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Reconcile the two ways a worker is addressed.
 *
 * nginx (and the vite dev proxy) route to a worker by URL prefix — /wN/... —
 * but each worker registers its routes unprefixed, so the prefix is stripped
 * here before routing. A prefix naming a different worker means the request
 * was misrouted, or the client computed the wrong worker for a game id, and is
 * refused rather than silently served by the wrong worker.
 */
export function stripWorkerPrefix(workerId: number): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // Extract the original path without the worker prefix
    const originalPath = req.url;
    const match = originalPath.match(/^\/w(\d+)(.*)$/);

    if (match) {
      const pathWorkerId = parseInt(match[1]);
      const actualPath = match[2] || "/";

      // Verify this request is for the correct worker
      if (pathWorkerId !== workerId) {
        res.status(404).json({
          error: "Worker mismatch",
          message: `This is worker ${workerId}, but you requested worker ${pathWorkerId}`,
        });
        return;
      }

      // Update the URL to remove the worker prefix
      req.url = actualPath;
    }

    next();
  };
}
