export function browserArtifactAliasStorageKey(alias: string): string {
	if (alias.length === 0)
		throw new Error('Browser artifact alias storage key is empty');
	return `${encodeURIComponent(alias)}.json`;
}
