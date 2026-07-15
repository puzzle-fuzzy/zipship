import { z } from "zod";

/**
 * Shared client-side validation schemas. Mirror the server's rules (see
 * `@zipship/deploy-core` `isValidProjectSlug` and the auth model min/max lengths)
 * so a form can't submit a value the API will reject.
 */

/** Project slug: lowercase letters/digits/`-`/`_`, starting alnum, ≤ 80 chars. */
export const projectSlugSchema = z
  .string()
  .trim()
  .min(1, { message: "Slug is required" })
  .max(80, { message: "Slug must be 80 characters or fewer" })
  .regex(/^[a-z0-9][a-z0-9_-]*$/, {
    message: "Slug must start with a letter or number and contain only lowercase letters, numbers, hyphens, and underscores",
  });

/** Free-form project / display name, 1–160 chars. */
export const projectNameSchema = z.string().trim().min(1, { message: "Name is required" }).max(160);

/** User display name, 1–120 chars. */
export const displayNameSchema = z.string().trim().min(1, { message: "Name is required" }).max(120);

/** Email normalized to lowercase. */
export const emailSchema = z.string().trim().toLowerCase().email({ message: "Enter a valid email" });

/** Password: 8–128 chars (matches the API). */
export const passwordSchema = z.string().min(12).max(128);

/** A whole create-project form. */
export const createProjectSchema = z.object({
  name: projectNameSchema,
  slug: projectSlugSchema,
  description: z.string().max(1000).optional().or(z.literal("")),
});
