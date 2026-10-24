import type {
	BrowserArtifactCachedAlias,
	BrowserArtifactCachedArtifact,
} from '../domain/browserArtifactCacheRecord.ts';

export type BrowserArtifactMetadataEntry = Readonly<{
	alias: BrowserArtifactCachedAlias;
	artifact: BrowserArtifactCachedArtifact | null;
}>;

export type BrowserArtifactMetadataRequest =
	| Readonly<{ id: number; operation: 'read'; alias: string }>
	| Readonly<{ id: number; operation: 'read-prefix'; prefix: string }>
	| Readonly<{
			id: number;
			operation: 'put-metadata';
			alias: string;
			metadata: unknown;
	  }>
	| Readonly<{
			id: number;
			operation: 'put-artifact';
			alias: string;
			metadata: unknown;
			artifact: BrowserArtifactCachedArtifact;
	  }>
	| Readonly<{
			id: number;
			operation: 'delete-aliases';
			aliases: readonly string[];
			protectedArtifactKeys: readonly string[];
	  }>
	| Readonly<{
			id: number;
			operation: 'delete-prefixes';
			prefixes: readonly string[];
			protectedArtifactKeys: readonly string[];
	  }>
	| Readonly<{ id: number; operation: 'invalidate'; artifactKey: string }>
	| Readonly<{ id: number; operation: 'finish-eviction' }>
	| Readonly<{
			id: number;
			operation: 'evict-oldest';
			unavailableArtifactKeys: readonly string[];
			protectedAliases: readonly string[];
	  }>;

export type BrowserArtifactMetadataResult =
	| BrowserArtifactMetadataEntry
	| readonly BrowserArtifactMetadataEntry[]
	| Readonly<{
			stored: boolean;
			removedArtifactKeys: readonly string[];
	  }>
	| Readonly<{ removedArtifactKeys: readonly string[] }>
	| null;

export type BrowserArtifactMetadataResponse =
	| Readonly<{
			id: number;
			ok: true;
			result: BrowserArtifactMetadataResult;
	  }>
	| Readonly<{ id: number; ok: false; name: string; message: string }>;
