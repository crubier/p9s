CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "document_title_trgm_idx" ON "document" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "document_content_trgm_idx" ON "document" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "folder_name_trgm_idx" ON "folder" USING gin ("name" gin_trgm_ops);