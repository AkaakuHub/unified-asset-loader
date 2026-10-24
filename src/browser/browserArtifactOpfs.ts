export const browserArtifactOpfsDirectoryName = 'browser-artifacts';
export const browserArtifactMetadataDirectoryName = 'metadata';
export const browserArtifactAliasDirectoryName = 'aliases';
export const browserArtifactManifestDirectoryName = 'artifacts';

export function browserArtifactBinaryFileName(artifactKey: string): string {
	return `${encodeURIComponent(artifactKey)}.bin`;
}

export function browserArtifactCompletionFileName(artifactKey: string): string {
	return `${encodeURIComponent(artifactKey)}.completion`;
}
