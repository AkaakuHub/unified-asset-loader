import { contentAddressedArtifactChunkSize } from './contentAddressedArtifact.ts';
import { ContentAddressedArtifactRangeResponseError } from './contentAddressedArtifactRangeError.ts';

export const browserArtifactCacheMaximumBytes = 4 * 1024 * 1024 * 1024;

export function browserArtifactCacheFailureAction(
	operation: 'metadata' | 'read' | 'transfer',
	cause: unknown,
): 'abort' | 'remove-alias' | 'preserve-partial' {
	if (cause instanceof DOMException && cause.name === 'AbortError')
		return 'abort';
	if (operation === 'metadata') return 'remove-alias';
	if (
		operation === 'transfer' &&
		cause instanceof ContentAddressedArtifactRangeResponseError &&
		cause.status === 404
	)
		return 'remove-alias';
	return operation === 'transfer' ? 'preserve-partial' : 'abort';
}

export function browserArtifactChunkCount(
	size: number,
	chunkSize = contentAddressedArtifactChunkSize,
): number {
	assertNonnegativeInteger(size, 'Artifact size');
	assertPositiveInteger(chunkSize, 'Artifact chunk size');
	return size === 0 ? 0 : Math.ceil(size / chunkSize);
}

export function browserArtifactChunkLength(
	artifactSize: number,
	chunkIndex: number,
	chunkSize = contentAddressedArtifactChunkSize,
): number {
	const chunkCount = browserArtifactChunkCount(artifactSize, chunkSize);
	assertNonnegativeInteger(chunkIndex, 'Artifact chunk index');
	if (chunkIndex >= chunkCount)
		throw new Error('Artifact chunk index is out of range');
	return Math.min(chunkSize, artifactSize - chunkIndex * chunkSize);
}

function assertNonnegativeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new Error(`${name} must be a nonnegative integer`);
}

function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new Error(`${name} must be a positive integer`);
}
