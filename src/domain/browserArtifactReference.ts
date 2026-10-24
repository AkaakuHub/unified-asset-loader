import type { ContentAddressedArtifactReference } from './contentAddressedArtifact.ts';

export type BrowserCatalogArtifactIdentity = Readonly<{
	assetPath: string;
	checksum: string;
	size: number;
}>;

export type BrowserArtifactReference =
	| ContentAddressedArtifactReference
	| (BrowserCatalogArtifactIdentity & Readonly<{ url: null }>);

export function locallyMaterializedBrowserArtifactReference(
	identity: BrowserCatalogArtifactIdentity,
): BrowserArtifactReference {
	return {
		assetPath: identity.assetPath,
		checksum: identity.checksum,
		size: identity.size,
		url: null,
	};
}

export function browserArtifactKey(
	reference: BrowserArtifactReference,
): string {
	return reference.url === null
		? `catalog:${JSON.stringify([
				reference.assetPath,
				reference.size,
				reference.checksum,
			])}`
		: `content-addressed:${reference.sha256}`;
}

export function browserArtifactReferencesMatch(
	left: BrowserArtifactReference,
	right: BrowserArtifactReference,
): boolean {
	return (
		browserArtifactKey(left) === browserArtifactKey(right) &&
		left.size === right.size &&
		left.url === right.url
	);
}

export function isBrowserArtifactReference(
	value: unknown,
): value is BrowserArtifactReference {
	if (!isRecord(value) || !isPositiveInteger(value.size)) return false;
	if (value.url === null) {
		return (
			hasExactKeys(value, ['assetPath', 'checksum', 'size', 'url']) &&
			typeof value.assetPath === 'string' &&
			value.assetPath.length > 0 &&
			typeof value.checksum === 'string' &&
			value.checksum.length > 0
		);
	}
	return (
		hasExactKeys(value, ['sha256', 'size', 'url']) &&
		typeof value.sha256 === 'string' &&
		/^[0-9a-f]{64}$/u.test(value.sha256) &&
		typeof value.url === 'string' &&
		value.url.length > 0
	);
}

export function remoteBrowserArtifactReference(
	reference: BrowserArtifactReference,
): ContentAddressedArtifactReference {
	if (reference.url === null)
		throw new Error('Browser artifact remote source is absent');
	return reference;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function hasExactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	const actualKeys = Object.keys(value);
	return (
		actualKeys.length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}
