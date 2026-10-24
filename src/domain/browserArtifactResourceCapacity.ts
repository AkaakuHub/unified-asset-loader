import { contentAddressedArtifactChunkSize } from './contentAddressedArtifact.ts';

export type BrowserArtifactResourceCapacity = Readonly<{
	parallelism: number;
	fileParallelism: number;
	scenePreparationParallelism: number;
	sourcePreparationParallelism: number;
	rangeParallelism: number;
	maximumConcurrentTransfers: number;
	maximumActiveBytes: number;
}>;

const maximumConcurrentTransfers = 100;

export function browserArtifactResourceCapacity(input: {
	hardwareConcurrency: number;
	deviceMemoryGibibytes: number | undefined;
	platform: string;
}): BrowserArtifactResourceCapacity {
	const parallelism = browserArtifactParallelism(input.hardwareConcurrency);
	const fileParallelism = Math.max(1, Math.ceil(parallelism / 2));
	const rangeParallelism = Math.max(1, Math.ceil(Math.sqrt(parallelism)));
	const workloadMaximumActiveBytes =
		parallelism * rangeParallelism * contentAddressedArtifactChunkSize;
	if (!Number.isSafeInteger(workloadMaximumActiveBytes))
		throw new Error('Browser artifact active byte capacity is invalid');
	const deviceMaximumActiveBytes = deviceMemoryMaximumActiveBytes(
		input.deviceMemoryGibibytes,
	);
	return {
		parallelism,
		fileParallelism,
		scenePreparationParallelism:
			input.platform === 'iPhone' ? 1 : fileParallelism,
		sourcePreparationParallelism:
			input.platform === 'iPhone' ? 1 : maximumConcurrentTransfers,
		rangeParallelism,
		maximumConcurrentTransfers,
		maximumActiveBytes:
			deviceMaximumActiveBytes === undefined
				? workloadMaximumActiveBytes
				: Math.min(workloadMaximumActiveBytes, deviceMaximumActiveBytes),
	};
}

function deviceMemoryMaximumActiveBytes(
	deviceMemoryGibibytes: number | undefined,
): number | undefined {
	if (deviceMemoryGibibytes === undefined) return undefined;
	if (!Number.isFinite(deviceMemoryGibibytes) || deviceMemoryGibibytes <= 0)
		throw new Error('Browser device memory is invalid');
	return Math.max(
		1,
		Math.floor((deviceMemoryGibibytes * 1024 * 1024 * 1024) / 8),
	);
}

export function browserArtifactParallelism(
	hardwareConcurrency: number,
): number {
	if (!Number.isSafeInteger(hardwareConcurrency) || hardwareConcurrency < 1)
		throw new Error('Browser hardware concurrency is invalid');
	return Math.max(1, Math.floor(hardwareConcurrency));
}

export function browserArtifactTransferActiveBytes(
	artifactSize: number,
	rangeParallelism: number,
	chunkSize = contentAddressedArtifactChunkSize,
): number {
	if (!Number.isSafeInteger(artifactSize) || artifactSize < 1)
		throw new Error('Browser artifact transfer size is invalid');
	if (!Number.isSafeInteger(rangeParallelism) || rangeParallelism < 1)
		throw new Error('Browser artifact range parallelism is invalid');
	if (!Number.isSafeInteger(chunkSize) || chunkSize < 1)
		throw new Error('Browser artifact chunk size is invalid');
	return Math.min(artifactSize, rangeParallelism * chunkSize);
}

export function browserArtifactResponseActiveBytes(
	artifactSize: number,
): number {
	if (!Number.isSafeInteger(artifactSize) || artifactSize < 1)
		throw new Error('Browser artifact response size is invalid');
	return artifactSize;
}
