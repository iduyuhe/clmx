import { Request, Response, NextFunction } from "express"

/**
 * asyncHandler — wraps an Express async route handler so that
 * unhandled promise rejections are forwarded to Express error middleware.
 * Without this, Express does NOT catch async errors automatically.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
