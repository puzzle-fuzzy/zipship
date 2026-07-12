ALTER TABLE "projects" ADD COLUMN "spa_fallback" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cache_policy" varchar(32) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "custom_domains" text[] DEFAULT '{}' NOT NULL;