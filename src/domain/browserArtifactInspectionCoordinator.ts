type InspectBrowserArtifact<Result> = (
	alias: string,
	assembleBinary: boolean,
) => Promise<Result>;

export function createBrowserArtifactInspectionCoordinator<Result>(
	inspect: InspectBrowserArtifact<Result>,
): Readonly<{
	inspectManifest(alias: string, signal: AbortSignal): Promise<Result>;
	inspectBinary(alias: string, signal: AbortSignal): Promise<Result>;
	inspectForMaterialization(
		alias: string,
		materialization: 'binary' | 'cache',
		signal: AbortSignal,
	): Promise<Result>;
}> {
	const inspectWithAbort = async (
		alias: string,
		assembleBinary: boolean,
		signal: AbortSignal,
	) => {
		if (signal.aborted) throw signal.reason;
		return await inspect(alias, assembleBinary);
	};
	return {
		inspectManifest: async (alias, signal) =>
			await inspectWithAbort(alias, false, signal),
		inspectBinary: async (alias, signal) =>
			await inspectWithAbort(alias, true, signal),
		inspectForMaterialization: async (alias, materialization, signal) =>
			await inspectWithAbort(alias, materialization === 'binary', signal),
	};
}
