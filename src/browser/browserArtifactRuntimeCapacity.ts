import {
	type BrowserArtifactResourceCapacity,
	browserArtifactResourceCapacity,
} from '../domain/browserArtifactResourceCapacity.ts';

let capacity: BrowserArtifactResourceCapacity | null = null;

export function browserArtifactRuntimeCapacity(): BrowserArtifactResourceCapacity {
	if (capacity !== null) return capacity;
	capacity = browserArtifactResourceCapacity({
		hardwareConcurrency: navigator.hardwareConcurrency,
		deviceMemoryGibibytes: readDeviceMemoryGibibytes(),
		platform: navigator.platform,
	});
	return capacity;
}

function readDeviceMemoryGibibytes(): number | undefined {
	if (!('deviceMemory' in navigator)) return undefined;
	const value: unknown = navigator.deviceMemory;
	return typeof value === 'number' ? value : undefined;
}
