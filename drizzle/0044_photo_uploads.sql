ALTER TABLE "host_photo_tries" DROP CONSTRAINT "host_photo_tries_network";--> statement-breakpoint
ALTER TABLE "host_photos" DROP CONSTRAINT "host_photos_network";--> statement-breakpoint
ALTER TABLE "host_photo_tries" ALTER COLUMN "entry_name_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "host_photos" ALTER COLUMN "source_name_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "host_photos" ALTER COLUMN "source_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "host_photo_tries" ADD CONSTRAINT "host_photo_tries_entry" CHECK (("host_photo_tries"."network" = 'upload' and "host_photo_tries"."entry_name_key" is null and "host_photo_tries"."entry_account_id" is null) or ("host_photo_tries"."network" <> 'upload' and "host_photo_tries"."entry_name_key" is not null));--> statement-breakpoint
ALTER TABLE "host_photo_tries" ADD CONSTRAINT "host_photo_tries_network" CHECK ("host_photo_tries"."network" in ('instagram', 'tiktok', 'upload'));--> statement-breakpoint
ALTER TABLE "host_photos" ADD CONSTRAINT "host_photos_source" CHECK (("host_photos"."network" = 'upload' and "host_photos"."source_name_key" is null and "host_photos"."source_account_id" is null) or ("host_photos"."network" <> 'upload' and "host_photos"."source_name_key" is not null and "host_photos"."source_account_id" is not null));--> statement-breakpoint
ALTER TABLE "host_photos" ADD CONSTRAINT "host_photos_network" CHECK ("host_photos"."network" in ('instagram', 'tiktok', 'upload'));