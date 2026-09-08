/**
 * Returns a shuffled copy without modifying the original preset.
 *
 * @template T
 * @param {readonly T[]} items
 * @param {() => number} [random]
 * @returns {T[]}
 */
export function shuffleProblems(items, random = Math.random) {
	const shuffled = [...items];
	for (let index = shuffled.length - 1; index > 0; index -= 1) {
		const target = Math.floor(random() * (index + 1));
		[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
	}
	return shuffled;
}
