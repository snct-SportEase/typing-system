CREATE TABLE `result_exports` (
	`export_id` text PRIMARY KEY NOT NULL,
	`result_fingerprint` text NOT NULL,
	`content_sha256` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`last_exported_at` integer NOT NULL,
	`last_exported_by` text NOT NULL,
	`export_count` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_exports_fingerprint_unique` ON `result_exports` (`result_fingerprint`);