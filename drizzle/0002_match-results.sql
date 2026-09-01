CREATE TABLE `match_results` (
	`match_number` integer NOT NULL,
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
	`rank` integer NOT NULL,
	`problem_set_id` text NOT NULL,
	`problem_set_version` integer NOT NULL,
	`finished_at` integer NOT NULL,
	PRIMARY KEY(`match_number`, `lane_number`)
);
