import {
	type BrowserArtifactReference,
	browserArtifactKey,
	browserArtifactReferencesMatch,
	isBrowserArtifactReference,
} from './browserArtifactReference.ts';

export type BrowserArtifactCachedAlias = Readonly<{
	alias: string;
	artifactKey: string | null;
	metadata: unknown;
	lastAccessedAt: number;
}>;

export type BrowserArtifactCachedArtifact = Readonly<{
	artifactKey: string;
	reference: BrowserArtifactReference;
	storage: 'opfs';
	lastAccessedAt: number;
}>;

export type BrowserArtifactEvictionInventory = Readonly<{
	aliases: readonly Pick<BrowserArtifactCachedAlias, 'alias' | 'artifactKey'>[];
	artifacts: readonly Pick<
		BrowserArtifactCachedArtifact,
		'artifactKey' | 'lastAccessedAt'
	>[];
}>;

export function removeBrowserArtifactFromEvictionInventory(
	inventory: BrowserArtifactEvictionInventory,
	artifactKey: string,
): BrowserArtifactEvictionInventory {
	return {
		aliases: inventory.aliases.filter(
			(alias) => alias.artifactKey !== artifactKey,
		),
		artifacts: inventory.artifacts.filter(
			(artifact) => artifact.artifactKey !== artifactKey,
		),
	};
}

export function parseBrowserArtifactCachedAlias(
	value: unknown,
): BrowserArtifactCachedAlias | null {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['alias', 'artifactKey', 'metadata', 'lastAccessedAt'])
	)
		return null;
	return typeof value.alias === 'string' &&
		value.alias.length > 0 &&
		(value.artifactKey === null || isArtifactKey(value.artifactKey)) &&
		isFiniteNonnegative(value.lastAccessedAt)
		? {
				alias: value.alias,
				artifactKey: value.artifactKey,
				metadata: value.metadata,
				lastAccessedAt: value.lastAccessedAt,
			}
		: null;
}

export function parseBrowserArtifactCachedArtifact(
	value: unknown,
): BrowserArtifactCachedArtifact | null {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'artifactKey',
			'reference',
			'storage',
			'lastAccessedAt',
		]) ||
		!isBrowserArtifactReference(value.reference)
	)
		return null;
	return isArtifactKey(value.artifactKey) &&
		value.artifactKey === browserArtifactKey(value.reference) &&
		value.storage === 'opfs' &&
		isFiniteNonnegative(value.lastAccessedAt)
		? {
				artifactKey: value.artifactKey,
				reference: value.reference,
				storage: value.storage,
				lastAccessedAt: value.lastAccessedAt,
			}
		: null;
}

export function mergeBrowserArtifactCachedArtifact(
	existing: BrowserArtifactCachedArtifact,
	incoming: BrowserArtifactCachedArtifact,
): BrowserArtifactCachedArtifact {
	if (
		existing.artifactKey !== incoming.artifactKey ||
		existing.reference.size !== incoming.reference.size ||
		!browserArtifactReferencesMatch(existing.reference, incoming.reference)
	)
		throw new Error('Browser artifact cache identity differs');
	return existing;
}

export function selectOldestAvailableBrowserArtifact(
	artifacts: Iterable<
		Pick<BrowserArtifactCachedArtifact, 'artifactKey' | 'lastAccessedAt'>
	>,
	unavailableArtifactKeys: ReadonlySet<string>,
	selectedArtifactKeys: ReadonlySet<string>,
): Pick<
	BrowserArtifactCachedArtifact,
	'artifactKey' | 'lastAccessedAt'
> | null {
	let oldest: Pick<
		BrowserArtifactCachedArtifact,
		'artifactKey' | 'lastAccessedAt'
	> | null = null;
	for (const artifact of artifacts) {
		if (
			unavailableArtifactKeys.has(artifact.artifactKey) ||
			selectedArtifactKeys.has(artifact.artifactKey)
		)
			continue;
		if (
			oldest === null ||
			artifact.lastAccessedAt < oldest.lastAccessedAt ||
			(artifact.lastAccessedAt === oldest.lastAccessedAt &&
				artifact.artifactKey < oldest.artifactKey)
		)
			oldest = artifact;
	}
	return oldest;
}

function isArtifactKey(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		(value.startsWith('catalog:') || value.startsWith('content-addressed:'))
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
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

function isFiniteNonnegative(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
