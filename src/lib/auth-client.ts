import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";

/** Client navigateur : appelle /api/auth/* sur la même origine. */
export const authClient = createAuthClient({ plugins: [passkeyClient()] });
