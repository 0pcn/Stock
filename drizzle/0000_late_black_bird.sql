CREATE TABLE `google_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `google_states` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`payload` text,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
