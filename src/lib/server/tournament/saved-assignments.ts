import { db } from '$lib/server/db';
import { matchAssignments } from '$lib/server/db/schema';
import { asc } from 'drizzle-orm';

export function getSavedAssignments() {
	return db
		.select()
		.from(matchAssignments)
		.orderBy(asc(matchAssignments.matchNumber), asc(matchAssignments.laneNumber))
		.all();
}
