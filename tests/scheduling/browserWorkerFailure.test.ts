import { expect, test } from 'bun:test';
import {
	assertBrowserWorkerCrossOriginIsolated,
	BrowserWorkerFailure,
	browserWorkerFailure,
	retryBrowserWorkerRead,
} from '../../src/application/scheduling/browserWorkerFailure.ts';

test('Workerのcross-origin isolationを起動時に検証する', () => {
	expect(() =>
		assertBrowserWorkerCrossOriginIsolated('Runtime Worker', false),
	).toThrow(
		'Runtime Worker requires a cross-origin isolated context with COOP: same-origin and COEP: require-corp',
	);
	expect(() =>
		assertBrowserWorkerCrossOriginIsolated('Runtime Worker', true),
	).not.toThrow();
});

test('Workerの元エラーと発生位置を保持する', () => {
	const cause = new Error('OPFS connection failed');
	const failure = browserWorkerFailure(
		'Browser artifact metadata Worker',
		new ErrorEvent('error', {
			error: cause,
			filename: 'metadata.worker.js',
			lineno: 12,
			colno: 34,
		}),
	);

	expect(failure.message).toBe(
		'Browser artifact metadata Worker failed: OPFS connection failed (metadata.worker.js:12:34)',
	);
	expect(failure.cause).toBe(cause);
});

test('Workerが詳細を省略したerrorイベントを処理する', () => {
	const failure = browserWorkerFailure('Browser artifact metadata Worker', {});

	expect(failure.message).toBe(
		'Browser artifact metadata Worker failed: module execution failed without an error message',
	);
});

test('Worker異常時だけ読取を一度再実行する', async () => {
	let attempts = 0;
	const result = await retryBrowserWorkerRead(async () => {
		attempts += 1;
		if (attempts === 1) throw new BrowserWorkerFailure('Worker terminated');
		return 'metadata';
	});

	expect(result).toBe('metadata');
	expect(attempts).toBe(2);
});

test('通常の処理エラーは再実行しない', async () => {
	let attempts = 0;
	const read = retryBrowserWorkerRead(async () => {
		attempts += 1;
		throw new Error('metadata is invalid');
	});

	await expect(read).rejects.toThrow('metadata is invalid');
	expect(attempts).toBe(1);
});
