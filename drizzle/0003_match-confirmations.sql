CREATE TABLE `match_confirmations` (
	`match_number` integer PRIMARY KEY NOT NULL,
	`confirmed_at` integer NOT NULL,
	`confirmed_by` text NOT NULL
);
