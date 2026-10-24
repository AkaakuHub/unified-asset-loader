export function browserArtifactFileCompletionByteLength(
	chunkCount: number,
): number {
	assertNonnegativeInteger(chunkCount, 'Artifact chunk count');
	return Math.ceil(chunkCount / 8);
}

export function createBrowserArtifactFileCompletion(
	chunkCount: number,
): Uint8Array {
	return new Uint8Array(browserArtifactFileCompletionByteLength(chunkCount));
}

export function parseBrowserArtifactFileCompletion(
	chunkCount: number,
	bytes: Uint8Array,
): Readonly<{
	missingIndexes: readonly number[];
	complete: boolean;
}> {
	if (bytes.byteLength !== browserArtifactFileCompletionByteLength(chunkCount))
		throw new Error('Artifact completion bitmap length differs');
	const missingIndexes: number[] = [];
	for (let index = 0; index < chunkCount; index += 1) {
		const byte = bytes[Math.floor(index / 8)];
		if (byte === undefined)
			throw new Error('Artifact completion bitmap is inconsistent');
		if ((byte & (1 << (index % 8))) === 0) missingIndexes.push(index);
	}
	return { missingIndexes, complete: missingIndexes.length === 0 };
}

export function markBrowserArtifactFileChunksComplete(
	chunkCount: number,
	bytes: Uint8Array,
	indexes: readonly number[],
): void {
	if (bytes.byteLength !== browserArtifactFileCompletionByteLength(chunkCount))
		throw new Error('Artifact completion bitmap length differs');
	const unique = new Set(indexes);
	if (
		unique.size !== indexes.length ||
		indexes.some(
			(index) =>
				!Number.isSafeInteger(index) || index < 0 || index >= chunkCount,
		)
	)
		throw new Error('Artifact completion chunk indexes are invalid');
	for (const index of indexes) {
		const byteIndex = Math.floor(index / 8);
		const byte = bytes[byteIndex];
		if (byte === undefined)
			throw new Error('Artifact completion bitmap is inconsistent');
		bytes[byteIndex] = byte | (1 << (index % 8));
	}
}

function assertNonnegativeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new Error(`${name} must be a nonnegative integer`);
}
