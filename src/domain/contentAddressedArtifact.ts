export const contentAddressedArtifactChunkSize = 4 * 1024 * 1024;

export type ContentAddressedArtifactIdentity = Readonly<{
	sha256: string;
	size: number;
}>;
export type ContentAddressedArtifactReference =
	ContentAddressedArtifactIdentity & Readonly<{ url: string }>;
export type ContentAddressedArtifactByteRange = Readonly<{
	start: number;
	endExclusive: number;
}>;
