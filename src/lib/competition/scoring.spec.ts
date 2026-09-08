import { describe, expect, it } from 'vitest';
import { calculateRawScore, calculateScore } from './scoring.js';

describe('competition scoring', () => {
	it('uses the 180-second competition formula without intermediate rounding', () => {
		expect(calculateRawScore(140, 6, 180)).toBeCloseTo((60 * 140 ** 4) / (180 * 146 ** 3));
		expect(calculateScore(140, 6, 180)).toBe(41);
	});

	it('returns zero when there are no attempts', () => {
		expect(calculateScore(0, 0, 180)).toBe(0);
	});
});
