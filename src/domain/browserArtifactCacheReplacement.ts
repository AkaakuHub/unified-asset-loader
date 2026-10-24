export async function requestWhileRemovingInvalidBrowserArtifactAlias<Result>(
	removeInvalidAlias: Promise<void>,
	request: () => Promise<Result>,
): Promise<Result> {
	const [, result] = await Promise.all([removeInvalidAlias, request()]);
	return result;
}
