type BrowserArtifactErrorResponse = Pick<Response, 'status' | 'text' | 'url'>;

export async function browserArtifactHttpError(
	response: BrowserArtifactErrorResponse,
): Promise<Error> {
	const body = (await response.text()).trim();
	return new Error(
		`Browser artifact request failed: status=${String(response.status)}; url=${response.url}; body=${body}`,
	);
}
