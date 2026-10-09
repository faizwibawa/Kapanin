/**
 * Express `Request` augmentation (design: Auth Middleware component).
 *
 * The auth middleware attaches the verified owner to the request as `req.user`
 * so downstream protected routes can read the authenticated identity without
 * re-parsing the JWT. The property is optional: it is only populated after the
 * middleware verifies a valid Bearer token (Requirement 2.1). On any failure
 * path the middleware responds `401` and never sets it (Requirement 2.2-2.5).
 */

/** The authenticated owner derived from a verified JWT. */
export interface AuthenticatedUser {
  /** `auth.users.id`, taken from the JWT `sub` claim. */
  id: string;
  /** Optional email claim, propagated when present on the token. */
  email?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
