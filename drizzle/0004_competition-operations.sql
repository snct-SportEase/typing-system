CREATE TABLE `match_attempt_results` (
	`match_number` integer NOT NULL,
	`attempt_number` integer NOT NULL,
	`lane_number` integer NOT NULL,
	`team_name` text NOT NULL,
	`representative_source` text NOT NULL,
	`correct_types` integer NOT NULL,
	`incorrect_types` integer NOT NULL,
	`completed_problems` integer NOT NULL,
	`wpm` real NOT NULL,
	`accuracy` real NOT NULL,
	`raw_score` real NOT NULL,
	`score` integer NOT NULL,
	`rank` integer,
	`captured_at` integer NOT NULL,
	PRIMARY KEY(`match_number`, `attempt_number`, `lane_number`)
);
--> statement-breakpoint
CREATE TABLE `match_attempts` (
	`match_number` integer NOT NULL,
	`attempt_number` integer NOT NULL,
	`problem_set_id` text NOT NULL,
	`problem_set_version` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`reason` text,
	`operated_by` text,
	PRIMARY KEY(`match_number`, `attempt_number`)
);
--> statement-breakpoint
CREATE TABLE `match_disqualifications` (
	`match_number` integer NOT NULL,
	`lane_number` integer NOT NULL,
	`reason` text NOT NULL,
	`disqualified_at` integer NOT NULL,
	`disqualified_by` text NOT NULL,
	PRIMARY KEY(`match_number`, `lane_number`)
);
--> statement-breakpoint
CREATE TABLE `match_operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_number` integer NOT NULL,
	`attempt_number` integer NOT NULL,
	`action` text NOT NULL,
	`lane_number` integer,
	`reason` text,
	`operated_at` integer NOT NULL,
	`operated_by` text NOT NULL
);
