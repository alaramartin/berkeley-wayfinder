/**
 * /field is for the person doing the walk, not for visitors. It is compiled in only when the build is
 * made with NEXT_PUBLIC_FIELD_MODE=1; without that the route and its service worker answer 404. The
 * production deploy is made without it, so the live site has no field tool at all.
 */
export const FIELD_ENABLED = process.env.NEXT_PUBLIC_FIELD_MODE === "1";
