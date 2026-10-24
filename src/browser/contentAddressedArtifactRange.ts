import type { ContentAddressedArtifactReference } from '../domain/contentAddressedArtifact.ts';
import {
	contentAddressedArtifactChunkRanges,
	contentAddressedArtifactRangeMaxAttempts,
	validateContentAddressedArtifactRange,
} from '../domain/contentAddressedArtifactRange.ts';
import { ContentAddressedArtifactRangeResponseError } from '../domain/contentAddressedArtifactRangeError.ts';

type DownloadedArtifactChunk = Readonly<{
	index: number;
	bytes: Uint8Array;
}>;

export async function fetchMissingContentAddressedArtifactChunks(input: {
	reference: ContentAddressedArtifactReference;
	missingIndexes: readonly number[];
	parallelism: number;
	signal: AbortSignal;
	write(chunks: readonly DownloadedArtifactChunk[]): Promise<void>;
	report(
		progress: Readonly<{
			networkReceivedBytes: number;
			savedBytes: number;
		}>,
	): void;
}): Promise<void> {
	const ranges = contentAddressedArtifactChunkRanges(
		input.reference,
		input.missingIndexes,
	);
	if (!Number.isSafeInteger(input.parallelism) || input.parallelism < 1)
		throw new Error('Artifact range parallelism must be a positive integer');
	let networkReceivedBytes = 0;
	let savedBytes = 0;
	let pendingBatch = fetchBatch(ranges.slice(0, input.parallelism), input);
	for (let offset = 0; offset < ranges.length; offset += input.parallelism) {
		const batch = await pendingBatch;
		const nextOffset = offset + input.parallelism;
		if (nextOffset < ranges.length)
			pendingBatch = fetchBatch(
				ranges.slice(nextOffset, nextOffset + input.parallelism),
				input,
			);
		const batchBytes = batch.reduce(
			(sum, { bytes }) => sum + bytes.byteLength,
			0,
		);
		networkReceivedBytes += batchBytes;
		input.report({ networkReceivedBytes, savedBytes });
		await input.write(batch);
		savedBytes += batchBytes;
		input.report({ networkReceivedBytes, savedBytes });
	}
}

function fetchBatch(
	ranges: ReturnType<typeof contentAddressedArtifactChunkRanges>,
	input: Pick<
		Parameters<typeof fetchMissingContentAddressedArtifactChunks>[0],
		'reference' | 'signal'
	>,
): Promise<readonly DownloadedArtifactChunk[]> {
	return Promise.all(
		ranges.map(async (range) => ({
			index: range.index,
			bytes: await fetchContentAddressedArtifactChunk({
				reference: input.reference,
				range,
				signal: input.signal,
			}),
		})),
	);
}

async function fetchContentAddressedArtifactChunk(input: {
	reference: ContentAddressedArtifactReference;
	range: Readonly<{ index: number; start: number; endExclusive: number }>;
	signal: AbortSignal;
}): Promise<Uint8Array> {
	let lastError: unknown;
	for (
		let attempt = 1;
		attempt <= contentAddressedArtifactRangeMaxAttempts;
		attempt += 1
	) {
		try {
			const response = await fetch(input.reference.url, {
				headers: {
					'If-Range': `"${input.reference.sha256}"`,
					Range: `bytes=${String(input.range.start)}-${String(input.range.endExclusive - 1)}`,
				},
				signal: input.signal,
			});
			const bytes = new Uint8Array(await response.arrayBuffer());
			validateContentAddressedArtifactRange(
				input.reference,
				input.range,
				response.status,
				response.headers,
				bytes.byteLength,
			);
			return bytes;
		} catch (cause) {
			if (input.signal.aborted) throw cause;
			lastError = cause;
			if (
				cause instanceof ContentAddressedArtifactRangeResponseError &&
				!cause.retryable
			)
				break;
		}
	}
	throw lastError;
}
