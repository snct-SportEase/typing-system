/**
 * Calculates the unrounded competition score directly from the input counts.
 *
 * @param {number} correctTypes
 * @param {number} incorrectTypes
 * @param {number} durationSeconds
 */
export function calculateRawScore(correctTypes, incorrectTypes, durationSeconds) {
	const attempts = correctTypes + incorrectTypes;
	if (attempts === 0 || durationSeconds <= 0) return 0;
	return (60 * correctTypes ** 4) / (durationSeconds * attempts ** 3);
}

/**
 * @param {number} correctTypes
 * @param {number} incorrectTypes
 * @param {number} durationSeconds
 */
export function calculateScore(correctTypes, incorrectTypes, durationSeconds) {
	return Math.floor(calculateRawScore(correctTypes, incorrectTypes, durationSeconds));
}
