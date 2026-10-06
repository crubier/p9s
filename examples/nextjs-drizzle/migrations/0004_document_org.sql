ALTER TABLE "folder" ADD CONSTRAINT "folder_id_org_id_unique" UNIQUE("id","org_id");--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "org_id" uuid;--> statement-breakpoint
UPDATE "document" SET "org_id" = "folder"."org_id" FROM "folder" WHERE "folder"."id" = "document"."folder_id";--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_folder_org_fk" FOREIGN KEY ("folder_id","org_id") REFERENCES "public"."folder"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" DROP CONSTRAINT "document_folder_id_folder_id_fk";
