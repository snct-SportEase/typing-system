import inputSpecification from '../docs/typing-input-tests-v1.json';
import { describe, expect, it } from 'vitest';
import { applyTypingEvent, createTypingState } from './typing-engine.js';

const startsAt = 1_000;
const endsAt = startsAt + 180_000;

describe('romanization conformance', () => {
	for (const testCase of inputSpecification.romanization_cases) {
		it(`${testCase.id} accepts only the specified romanizations`, () => {
			for (const input of testCase.accepted_inputs) {
				const state = createTypingState([testCase.reading]);
				for (const [index, key] of [...input].entries()) {
					applyTypingEvent(state, { type: 'key', key }, startsAt + index, startsAt, endsAt);
				}
				expect(state.completedProblems, `${testCase.id}: ${input}`).toBe(1);
				expect(state.incorrectTypes, `${testCase.id}: ${input}`).toBe(0);
			}

			for (const input of testCase.rejected_inputs) {
				const state = createTypingState([testCase.reading]);
				for (const [index, key] of [...input].entries()) {
					applyTypingEvent(state, { type: 'key', key }, startsAt + index, startsAt, endsAt);
				}
				expect(
					state.completedProblems === 1 && state.incorrectTypes === 0,
					`${testCase.id}: ${input}`
				).toBe(false);
			}
		});
	}
});

describe('typing event conformance', () => {
	for (const testCase of inputSpecification.event_cases) {
		it(testCase.description, () => {
			const state = createTypingState(testCase.problems);
			const duration = testCase.duration_ms ?? 180_000;

			for (const event of testCase.events) {
				applyTypingEvent(
					state,
					{
						type: event.type,
						key: 'key' in event ? event.key : undefined,
						repeat: 'repeat' in event ? event.repeat : undefined,
						shift: 'shift' in event ? event.shift : undefined,
						ctrl: 'ctrl' in event ? event.ctrl : undefined,
						alt: 'alt' in event ? event.alt : undefined,
						meta: 'meta' in event ? event.meta : undefined,
						composing: event.type === 'composition'
					},
					startsAt + event.receive_offset_ms,
					startsAt,
					startsAt + duration
				);
			}

			expect({
				correct_types: state.correctTypes,
				incorrect_types: state.incorrectTypes,
				completed_problems: state.completedProblems,
				current_problem_index: state.currentProblemIndex,
				current_input_position: state.typedRoman.length
			}).toEqual(testCase.expected);
		});
	}
});
