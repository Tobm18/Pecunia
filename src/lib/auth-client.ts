import { createAuthClient } from "better-auth/react";

/** Client navigateur : appelle /api/auth/* sur la même origine. */
export const authClient = createAuthClient();
