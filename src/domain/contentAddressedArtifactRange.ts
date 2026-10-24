import {
	browserArtifactChunkCount,
	browserArtifactChunkLength,
} from './browserArtifactCache.ts';
import {
	type ContentAddressedArtifactReference,
	contentAddressedArtifactChunkSize,
} from './contentAddressedArtifact.ts';
import { ContentAddressedArtifactRangeResponseError } from './contentAddressedArtifactRangeError.ts';

export const contentAddressedArtifactRangeMaxAttempts = 3;

type ContentAddressedArtifactChunkRange = Readonly<{
	index: number;
	start: number;
	endExclusive: number;
}>;

export function contentAddressedArtifactChunkRanges(
	reference: ContentAddressedArtifactReference,
	indexes: readonly number[],
): readonly ContentAddressedArtifactChunkRange[] {
	const chunkCount = browserArtifactChunkCount(reference.size);
	const unique = new Set(indexes);
	if (
		unique.size !== indexes.length ||
		indexes.some(
			(index) =>
				!Number.isSafeInteger(index) || index < 0 || index >= chunkCount,
		)
	)
		throw new Error('Content-addressed artifact chunk indexes are invalid');
	return [...indexes]
		.sort((left, right) => left - right)
		.map((index) => {
			const start = index * contentAddressedArtifactChunkSize;
			return {
				index,
				start,
				endExclusive: start + browserArtifactChunkLength(reference.size, index),
			};
		});
}

export function contentAddressedArtifactExistingBytes(
	reference: ContentAddressedArtifactReference,
	missingIndexes: readonly number[],
): number {
	const missingBytes = contentAddressedArtifactChunkRanges(
		reference,
		missingIndexes,
	).reduce((sum, range) => sum + range.endExclusive - range.start, 0);
	return reference.size - missingBytes;
}

export function validateContentAddressedArtifactRange(
	reference: ContentAddressedArtifactReference,
	range: ContentAddressedArtifactChunkRange,
	status: number,
	headers: Headers,
	byteLength: number,
): void {
	const length = range.endExclusive - range.start;
	const contentLength = headers.get('content-length');
	const etag = headers.get('etag');
	const contentRange = headers.get('content-range');
	const expectedEtag = `"${reference.sha256}"`;
	const expectedContentRange = `bytes ${String(range.start)}-${String(range.endExclusive - 1)}/${String(reference.size)}`;
	const retryableStatus = status === 408 || status === 429 || status >= 500;
	const interruptedBody =
		status === 206 &&
		etag === expectedEtag &&
		contentRange === expectedContentRange &&
		contentLength === null &&
		byteLength !== length;
	if (
		status === 206 &&
		etag === expectedEtag &&
		(contentLength === null || contentLength === String(length)) &&
		contentRange === expectedContentRange &&
		byteLength === length
	)
		return;
	throw new ContentAddressedArtifactRangeResponseError({
		status,
		etag,
		contentLength,
		contentRange,
		byteLength,
		expectedByteLength: length,
		retryable: retryableStatus || interruptedBody,
	});
}
