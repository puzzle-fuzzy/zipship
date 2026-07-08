// Schema barrel. Tables are split by domain to keep the file readable as the
// schema grows; this re-exports everything so `import * as schema from "@zipship/db"`
// keeps working unchanged.
export * from "./_shared";
export * from "./accounts";
export * from "./content";
export * from "./desktop";
