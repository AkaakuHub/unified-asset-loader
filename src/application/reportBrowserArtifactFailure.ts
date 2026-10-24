import { unknownErrorMessage } from '../domain/unknownErrorMessage.ts';

export function reportBrowserArtifactFailure(
	alias: string,
	cause: unknown,
): string | null {
	if (cause instanceof DOMException && cause.name === 'AbortError') return null;
	console.error(`[browser-artifact-loader] ${alias}`, cause);
	return unknownErrorMessage(cause);
}
