import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

/** Client navigateur : appelle /api/auth/* sur la même origine. */
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });
