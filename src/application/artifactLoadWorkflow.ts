import type { ArtifactLoadEntryEvent } from '../domain/artifactLoadEntryState.ts';
import type { ContentArtifactLoadProgress } from '../domain/contentArtifactLoadProgress.ts';
import { unknownErrorMessage } from '../domain/unknownErrorMessage.ts';
import { reportBrowserArtifactFailure } from './reportBrowserArtifactFailure.ts';

type ArtifactLoadDescriptor = Readonly<{
	identity: string;
	assetType: string;
	label: string;
}>;

export async function runArtifactLoadStep<Value>(
	descriptor: ArtifactLoadDescriptor,
	reportLoadEvent: (event: ArtifactLoadEntryEvent) => void,
	load: (
		reportProgress: (progress: ContentArtifactLoadProgress) => void,
		reportCacheWriteFailure: (message: string) => void,
	) => Promise<Value>,
): Promise<Value> {
	reportLoadEvent({ type: 'started', ...descriptor });
	try {
		const value = await load(
			(progress) =>
				reportLoadEvent({ type: 'progress', ...descriptor, progress }),
			(message) =>
				reportLoadEvent({
					type: 'failed',
					identity: `${descriptor.identity}:cache`,
					assetType: `${descriptor.assetType} cache`,
					label: descriptor.label,
					error: message,
				}),
		);
		reportLoadEvent({ type: 'completed', ...descriptor });
		return value;
	} catch (cause) {
		reportLoadEvent({
			type: 'failed',
			...descriptor,
			error: unknownErrorMessage(cause),
		});
		throw cause;
	}
}

export async function runArtifactLocalStep<Value>(
	descriptor: ArtifactLoadDescriptor,
	reportLoadEvent: (event: ArtifactLoadEntryEvent) => void,
	run: () => Value | Promise<Value>,
): Promise<Value> {
	reportLoadEvent({ type: 'started', ...descriptor });
	try {
		const value = await run();
		reportLoadEvent({ type: 'completed', ...descriptor });
		return value;
	} catch (cause) {
		reportBrowserArtifactFailure(descriptor.identity, cause);
		reportLoadEvent({
			type: 'failed',
			...descriptor,
			error: unknownErrorMessage(cause),
		});
		throw cause;
	}
}
