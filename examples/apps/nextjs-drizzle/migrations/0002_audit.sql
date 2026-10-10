CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_member_id" uuid,
	"actor_name" text,
	"api_key_name" text,
	"impersonator_member_id" uuid,
	"impersonator_name" text,
	"action" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid,
	"subject_name" text,
	"detail" text,
	"permission" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_member_id_member_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_impersonator_member_id_member_id_fk" FOREIGN KEY ("impersonator_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_org_id_created_at_idx" ON "audit_event" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_actor_member_id_idx" ON "audit_event" USING btree ("actor_member_id");--> statement-breakpoint
CREATE INDEX "document_updated_at_idx" ON "document" USING btree ("updated_at");