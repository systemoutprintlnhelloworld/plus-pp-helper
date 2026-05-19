import test from 'node:test';
import assert from 'node:assert/strict';

import { runAutoFlowBatch } from '../shared/auto-flow.js';
import { createAutoRunPausedError } from '../shared/auto-run-control.js';

test('runAutoFlowBatch repeats successful runs up to runCount', async () => {
  const calls = [];

  const result = await runAutoFlowBatch({
    runCount: 2,
    continueOnError: false,
    runFlow: async (attempt) => {
      calls.push(`run:${attempt}`);
      return { status: 'completed', attempt };
    },
  });

  assert.deepEqual(calls, ['run:0', 'run:1']);
  assert.equal(result.results.length, 2);
  assert.equal(result.failures.length, 0);
});

test('runAutoFlowBatch continues after failure when continueOnError is enabled', async () => {
  const calls = [];

  const result = await runAutoFlowBatch({
    runCount: 3,
    continueOnError: true,
    runFlow: async (attempt) => {
      calls.push(`run:${attempt}`);
      if (attempt === 1) {
        throw new Error('step failed');
      }
      return { status: 'completed', attempt };
    },
    onAttemptError: async (error, attempt) => {
      calls.push(`error:${attempt}:${error.message}`);
    },
  });

  assert.deepEqual(calls, [
    'run:0',
    'run:1',
    'error:1:step failed',
    'run:2',
  ]);
  assert.equal(result.results.length, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].attempt, 1);
});

test('runAutoFlowBatch can resume from a start index', async () => {
  const calls = [];

  const result = await runAutoFlowBatch({
    runCount: 3,
    startIndex: 1,
    runFlow: async (attempt) => {
      calls.push(`run:${attempt}`);
      return { status: 'completed', attempt };
    },
  });

  assert.deepEqual(calls, ['run:1', 'run:2']);
  assert.deepEqual(result.results.map((item) => item.attempt), [1, 2]);
  assert.equal(result.failures.length, 0);
});

test('runAutoFlowBatch stops cleanly and reports the resume cursor when paused', async () => {
  const calls = [];
  let pauseCursor = null;

  const result = await runAutoFlowBatch({
    runCount: 3,
    runFlow: async (attempt) => {
      calls.push(`run:${attempt}`);
      if (attempt === 1) {
        throw createAutoRunPausedError('pause now');
      }
      return { status: 'completed', attempt };
    },
    onPaused: async (resumeIndex, error) => {
      pauseCursor = resumeIndex;
      calls.push(`paused:${resumeIndex}:${error.message}`);
    },
  });

  assert.deepEqual(calls, [
    'run:0',
    'run:1',
    'paused:1:pause now',
  ]);
  assert.equal(pauseCursor, 1);
  assert.deepEqual(result.results.map((item) => item.attempt), [0]);
  assert.equal(result.failures.length, 0);
  assert.equal(result.pausedAt, 1);
});
