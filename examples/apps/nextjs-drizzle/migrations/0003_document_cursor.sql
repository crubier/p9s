DROP INDEX "document_updated_at_idx";--> statement-breakpoint
CREATE INDEX "document_updated_at_idx" ON "document" USING btree ("updated_at","id");