-- p9s follows the parent folder, or else the organization, so the trigger that copied the resource id of either into
-- parent_resource_id goes away. The foreign key keeps a folder in the organization of its parent instead.
DROP TRIGGER IF EXISTS "folder_parent_resource" ON "folder";--> statement-breakpoint
DROP FUNCTION IF EXISTS "folder_parent_resource"();--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_parent_org_fk" FOREIGN KEY ("parent_id","org_id") REFERENCES "public"."folder"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" DROP CONSTRAINT "folder_parent_id_folder_id_fk";--> statement-breakpoint
DROP INDEX "folder_parent_resource_id_idx";--> statement-breakpoint
-- With the p9s policies that read it, which migrations/p9s.sql creates again right after: until then, users cannot
-- insert or move folders
ALTER TABLE "folder" DROP COLUMN "parent_resource_id" CASCADE;
