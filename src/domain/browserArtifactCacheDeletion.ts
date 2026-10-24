import type { BrowserArtifactAliasInvalidation } from './browserArtifactAliasInvalidation.ts';

export async function deleteBrowserAndServerArtifactCache(
	aliases: readonly string[],
	invalidation: BrowserArtifactAliasInvalidation,
	removeBrowserEntry: () => Promise<void>,
	removeServerEntry: () => Promise<void>,
): Promise<void> {
	if (aliases.length === 0)
		throw new Error('Browser artifact cache deletion aliases are empty');
	await invalidation.run(aliases, async () => {
		await Promise.all([removeBrowserEntry(), removeServerEntry()]);
	});
}
