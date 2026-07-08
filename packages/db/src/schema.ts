// Re-export the domain-split schema. drizzle-kit loads this file (see
// drizzle.config.ts -> schema), and all consumers import via "@zipship/db".
export * from "./schema/index";
