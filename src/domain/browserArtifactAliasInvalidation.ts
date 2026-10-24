export type BrowserArtifactAliasInvalidation = Readonly<{
	isInvalidated(alias: string): boolean;
	run(aliases: readonly string[], remove: () => Promise<void>): Promise<void>;
}>;

export function createBrowserArtifactAliasInvalidation(): BrowserArtifactAliasInvalidation {
	const invalidatedAliases = new Map<string, number>();

	return {
		isInvalidated: (alias) => invalidatedAliases.has(alias),
		run: async (aliases, remove) => {
			for (const alias of aliases)
				invalidatedAliases.set(alias, (invalidatedAliases.get(alias) ?? 0) + 1);
			try {
				await remove();
			} finally {
				for (const alias of aliases) {
					const count = invalidatedAliases.get(alias);
					if (count === undefined || count === 1)
						invalidatedAliases.delete(alias);
					else invalidatedAliases.set(alias, count - 1);
				}
			}
		},
	};
}
