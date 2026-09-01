CREATE TABLE `match_assignments` (
	`match_number` integer NOT NULL,
	`team_name` text NOT NULL,
	`representative_source` text NOT NULL,
	`lane_number` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`match_number`, `team_name`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_assignments_match_lane_unique` ON `match_assignments` (`match_number`,`lane_number`);