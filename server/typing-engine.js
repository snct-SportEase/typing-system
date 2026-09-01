import { readFileSync } from 'node:fs';

const inputSpecification = JSON.parse(
	readFileSync(new URL('../docs/typing-input-tests-v1.json', import.meta.url), 'utf8')
);
/** @type {Record<string, string[]>} */
const romanizationTable = inputSpecification.romanization_table;

/**
 * @typedef {{ displayText: string, reading: string }} TypingProblem
 * @typedef {{ segmentIndex: number, variant: string, characterIndex: number }} InputPath
 * @typedef {{ segments: string[][], activePaths: InputPath[], typedRoman: string, carryPaths: InputPath[], carrySegments: string[][], carrySegmentCount: number }} ProblemInput
 * @typedef {ProblemInput & { problems: TypingProblem[], currentProblemIndex: number, correctTypes: number, incorrectTypes: number, completedProblems: number }} TypingState
 */

/**
 * @param {(string | TypingProblem)[]} problems
 * @returns {TypingState}
 */
export function createTypingState(problems) {
	if (problems.length === 0) throw new Error('At least one typing problem is required');

	const normalizedProblems = problems.map((problem) =>
		typeof problem === 'string'
			? { displayText: problem, reading: problem }
			: { displayText: problem.displayText, reading: problem.reading }
	);

	return {
		problems: normalizedProblems,
		currentProblemIndex: 0,
		correctTypes: 0,
		incorrectTypes: 0,
		completedProblems: 0,
		...createProblemInput(normalizedProblems[0].reading)
	};
}

/**
 * Applies one browser input event using the server receipt time as the authority.
 *
 * @param {TypingState} state
 * @param {{ type: string, key?: string, repeat?: boolean, shift?: boolean, ctrl?: boolean, alt?: boolean, meta?: boolean, composing?: boolean }} event
 * @param {number} receivedAt
 * @param {number} startsAt
 * @param {number} endsAt
 */
export function applyTypingEvent(state, event, receivedAt, startsAt, endsAt) {
	if (receivedAt < startsAt || receivedAt >= endsAt)
		return { accepted: false, reason: 'outside_time' };
	if (event.type !== 'key') return { accepted: false, reason: 'unsupported_event' };
	if (event.repeat || event.ctrl || event.alt || event.meta || event.composing) {
		return { accepted: false, reason: 'ignored_key' };
	}

	const key = normalizeKey(event.key);
	if (key === null) return { accepted: false, reason: 'ignored_key' };
	if (state.carryPaths.length > 0) {
		const continuedPaths = deduplicatePaths(
			state.carryPaths
				.filter((path) => path.variant[path.characterIndex] === key)
				.flatMap((path) => advancePath(path, state.carrySegments))
		);
		state.carryPaths = [];
		state.carrySegments = [];
		if (continuedPaths.some((path) => path.segmentIndex === state.carrySegmentCount)) {
			state.correctTypes += 1;
			return { accepted: true, correct: true, completedProblem: false };
		}
	}

	const nextPaths = deduplicatePaths(
		state.activePaths
			.filter((path) => path.variant[path.characterIndex] === key)
			.flatMap((path) => advancePath(path, state.segments))
	);

	if (nextPaths.length === 0) {
		state.incorrectTypes += 1;
		return { accepted: true, correct: false, completedProblem: false };
	}

	state.correctTypes += 1;
	state.typedRoman += key;

	if (nextPaths.some((path) => path.segmentIndex === state.segments.length)) {
		const carryPaths = nextPaths.filter((path) => path.segmentIndex !== state.segments.length);
		const carrySegments = state.segments;
		state.completedProblems += 1;
		state.currentProblemIndex = (state.currentProblemIndex + 1) % state.problems.length;
		Object.assign(state, createProblemInput(state.problems[state.currentProblemIndex].reading));
		state.carryPaths = carryPaths;
		state.carrySegments = carrySegments;
		state.carrySegmentCount = carrySegments.length;
		return { accepted: true, correct: true, completedProblem: true };
	}

	state.activePaths = nextPaths;
	return { accepted: true, correct: true, completedProblem: false };
}

/**
 * @param {TypingState} state
 */
export function getTypingView(state) {
	const problem = state.problems[state.currentProblemIndex];
	const remaining = representativeRemainder(state.activePaths, state.segments);
	return {
		problemIndex: state.currentProblemIndex,
		problemCount: state.problems.length,
		displayText: problem.displayText,
		reading: problem.reading,
		romanizedText: state.typedRoman + remaining,
		inputPosition: state.typedRoman.length,
		correctTypes: state.correctTypes,
		incorrectTypes: state.incorrectTypes,
		completedProblems: state.completedProblems
	};
}

/**
 * @param {string} reading
 * @returns {ProblemInput}
 */
function createProblemInput(reading) {
	const segments = createRomanizationSegments(reading);
	return {
		segments,
		activePaths: initialPaths(segments),
		typedRoman: '',
		carryPaths: [],
		carrySegments: [],
		carrySegmentCount: 0
	};
}

/**
 * @param {string} reading
 */
export function createRomanizationSegments(reading) {
	const normalized = normalizeReading(reading);
	/** @type {string[][]} */
	const segments = [];

	for (let index = 0; index < normalized.length;) {
		const character = normalized[index];

		if (character === 'ん') {
			const nextCharacter = normalized[index + 1];
			const variants =
				!nextCharacter || !isVowelNOrY(nextCharacter)
					? ['nn', 'n']
					: isNCharacter(nextCharacter)
						? ['n']
						: ['nn', "n'"];
			segments.push(variants);
			index += 1;
			continue;
		}

		if (character === 'っ') {
			const nextToken = tokenAt(normalized, index + 1);
			if (!nextToken) {
				segments.push(['xtu', 'ltu']);
				index += 1;
				continue;
			}

			const standalone = nextToken.variants.flatMap((variant) => [
				`xtu${variant}`,
				`ltu${variant}`
			]);
			const doubled = nextToken.variants
				.filter((variant) => /^[bcdfghjklmpqrstvwxyz]/.test(variant))
				.map((variant) => variant[0] + variant);
			segments.push([...new Set([...doubled, ...standalone])]);
			index = nextToken.endIndex;
			continue;
		}

		const token = tokenAt(normalized, index);
		if (!token) {
			segments.push([]);
			index += 1;
			continue;
		}

		segments.push(token.variants);
		index = token.endIndex;
	}

	return segments;
}

/**
 * @param {string} reading
 * @param {number} index
 * @returns {{ variants: string[], endIndex: number } | null}
 */
function tokenAt(reading, index) {
	if (index >= reading.length) return null;
	const pair = reading.slice(index, index + 2);
	if (romanizationTable[pair]) {
		return { variants: romanizationTable[pair], endIndex: index + 2 };
	}

	const character = reading[index];
	if (!romanizationTable[character]) return null;
	return { variants: romanizationTable[character], endIndex: index + 1 };
}

/**
 * @param {string[][]} segments
 * @returns {InputPath[]}
 */
function initialPaths(segments) {
	return (segments[0] ?? []).map((variant) => ({
		segmentIndex: 0,
		variant,
		characterIndex: 0
	}));
}

/**
 * @param {InputPath} path
 * @param {string[][]} segments
 * @returns {InputPath[]}
 */
function advancePath(path, segments) {
	if (path.characterIndex + 1 < path.variant.length) {
		return [{ ...path, characterIndex: path.characterIndex + 1 }];
	}

	const nextSegmentIndex = path.segmentIndex + 1;
	if (nextSegmentIndex === segments.length) {
		return [{ segmentIndex: segments.length, variant: '', characterIndex: 0 }];
	}

	return segments[nextSegmentIndex].map((variant) => ({
		segmentIndex: nextSegmentIndex,
		variant,
		characterIndex: 0
	}));
}

/**
 * @param {InputPath[]} paths
 */
function deduplicatePaths(paths) {
	const unique = new Map();
	for (const path of paths) {
		unique.set(`${path.segmentIndex}:${path.variant}:${path.characterIndex}`, path);
	}
	return [...unique.values()];
}

/**
 * @param {InputPath[]} paths
 * @param {string[][]} segments
 */
function representativeRemainder(paths, segments) {
	const candidates = paths.map((path) => {
		const current = path.variant.slice(path.characterIndex);
		const rest = segments
			.slice(path.segmentIndex + 1)
			.map((variants) => shortest(variants))
			.join('');
		return current + rest;
	});
	return shortest(candidates);
}

/**
 * @param {string[]} values
 */
function shortest(values) {
	return (
		[...values].sort((left, right) => left.length - right.length || left.localeCompare(right))[0] ??
		''
	);
}

/**
 * @param {string | undefined} key
 */
function normalizeKey(key) {
	if (!key || key.length !== 1) return null;
	return /^[A-Z]$/.test(key) ? key.toLowerCase() : key;
}

/**
 * @param {string} reading
 */
function normalizeReading(reading) {
	return reading
		.normalize('NFC')
		.replace(/[ァ-ヶ]/g, (character) =>
			String.fromCharCode(character.charCodeAt(0) - 'ァ'.charCodeAt(0) + 'ぁ'.charCodeAt(0))
		);
}

/**
 * @param {string} character
 */
function isVowelNOrY(character) {
	return /^[あいうえおなにぬねのやゆよぁぃぅぇぉゃゅょ]$/.test(character);
}

/**
 * @param {string} character
 */
function isNCharacter(character) {
	return /^[なにぬねの]$/.test(character);
}
