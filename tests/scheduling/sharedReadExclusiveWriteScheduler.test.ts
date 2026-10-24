import { describe, expect, test } from 'bun:test';
import { SharedReadExclusiveWriteScheduler } from '../../src/application/scheduling/sharedReadExclusiveWriteScheduler.ts';

describe('SharedReadExclusiveWriteScheduler', () => {
	test('互いに独立したreadを並列実行する', async () => {
		const scheduler = new SharedReadExclusiveWriteScheduler();
		const release = Promise.withResolvers<void>();
		const started: string[] = [];
		const read = (identity: string) =>
			scheduler.scheduleRead(async () => {
				started.push(identity);
				await release.promise;
				return identity;
			});

		const first = read('first');
		const second = read('second');
		await Promise.resolve();
		expect(started).toEqual(['first', 'second']);
		release.resolve();
		expect(await Promise.all([first, second])).toEqual(['first', 'second']);
	});

	test('writeは先行readを待ち、後続readはwriteを待つ', async () => {
		const scheduler = new SharedReadExclusiveWriteScheduler();
		const releaseRead = Promise.withResolvers<void>();
		const releaseWrite = Promise.withResolvers<void>();
		const readStarted = Promise.withResolvers<void>();
		const writeStarted = Promise.withResolvers<void>();
		const events: string[] = [];
		const firstRead = scheduler.scheduleRead(async () => {
			events.push('read:start');
			readStarted.resolve();
			await releaseRead.promise;
			events.push('read:end');
		});
		const write = scheduler.scheduleWrite(async () => {
			events.push('write:start');
			writeStarted.resolve();
			await releaseWrite.promise;
			events.push('write:end');
		});
		const secondRead = scheduler.scheduleRead(async () => {
			events.push('next-read');
		});

		await readStarted.promise;
		expect(events).toEqual(['read:start']);
		releaseRead.resolve();
		await Promise.all([firstRead, writeStarted.promise]);
		expect(events).toEqual(['read:start', 'read:end', 'write:start']);
		releaseWrite.resolve();
		await Promise.all([write, secondRead]);
		expect(events).toEqual([
			'read:start',
			'read:end',
			'write:start',
			'write:end',
			'next-read',
		]);
	});

	test('失敗した処理の後もqueueを継続する', async () => {
		const scheduler = new SharedReadExclusiveWriteScheduler();
		await expect(
			scheduler.scheduleWrite(async () => {
				throw new Error('failed');
			}),
		).rejects.toThrow('failed');
		expect(await scheduler.scheduleRead(async () => 'continued')).toBe(
			'continued',
		);
	});
});
