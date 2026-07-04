import { ZIPSHIP_RESERVED_SLUGS } from "@zipship/shared";

const slugPattern = /^[a-z0-9][a-z0-9_-]*$/;

export function isValidProjectSlug(slug: string): boolean {
  return slugPattern.test(slug) && !ZIPSHIP_RESERVED_SLUGS.includes(slug as never);
}
