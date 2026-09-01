import { z } from 'zod';

export const clientMessageSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('system.ping') }).strict(),
	z.object({ type: z.literal('results.subscribe') }).strict(),
	z.object({ type: z.literal('admin.subscribe') }).strict(),
	z
		.object({
			type: z.literal('monitor.subscribe'),
			data: z.object({ matchNumber: z.number().int().min(1).max(3) }).strict()
		})
		.strict(),
	z
		.object({
			type: z.literal('typing.join'),
			data: z
				.object({
					matchNumber: z.number().int().min(1).max(3),
					laneNumber: z.number().int().min(1).max(6)
				})
				.strict()
		})
		.strict(),
	z.object({ type: z.literal('typing.ready') }).strict(),
	z
		.object({
			type: z.literal('typing.input'),
			data: z
				.object({
					key: z.string().min(1).max(16),
					repeat: z.boolean().optional(),
					shift: z.boolean().optional(),
					ctrl: z.boolean().optional(),
					alt: z.boolean().optional(),
					meta: z.boolean().optional(),
					composing: z.boolean().optional()
				})
				.strict()
		})
		.strict()
]);

/**
 * @param {unknown} value
 */
export function parseClientMessage(value) {
	return clientMessageSchema.safeParse(value);
}
