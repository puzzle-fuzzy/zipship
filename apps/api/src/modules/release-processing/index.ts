/**
 * Release-processing module — internal (no HTTP routes). Drives the deploy-core
 * pipeline: extract → detect → manifest → store, invoked when an upload
 * completes.
 */
export { ReleaseProcessingService } from "./service";
export type {
  ReleaseProcessingRepository,
  ReleaseProcessingServiceOptions,
} from "./service";
export { createDrizzleReleaseProcessingRepository } from "./drizzle-repository";
