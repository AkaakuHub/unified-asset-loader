type BrowserArtifactFileOperation =
	| Readonly<{ kind: 'inspect' | 'read' }>
	| Readonly<{ kind: 'write'; byteLength: number }>;

export function browserArtifactFileOperationWeight(
	operation: BrowserArtifactFileOperation,
): number {
	if (operation.kind !== 'write') return 1;
	if (!Number.isSafeInteger(operation.byteLength) || operation.byteLength < 0)
		throw new Error('Browser artifact file write byte length is invalid');
	return Math.max(1, operation.byteLength);
}
