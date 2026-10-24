import {
	type ContentArtifactLoadProgress,
	contentArtifactLoadProgress,
} from '../domain/contentArtifactLoadProgress.ts';

const progressReportIntervalBytes = 256 * 1024;

export async function readArtifactResponseBinary(
	response: Response,
	expectedBytes: number,
	reportProgress: ((progress: ContentArtifactLoadProgress) => void) | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)
		throw new Error('Browser artifact response size is invalid');
	if (response.body === null)
		throw new Error('Browser artifact response body is absent');

	const binary = new Uint8Array(expectedBytes);
	const reader = response.body.getReader();
	let receivedBytes = 0;
	let reportedBytes = 0;
	reportProgress?.(transferProgress(0, expectedBytes));
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			if (chunk.value === undefined)
				throw new Error('Browser artifact response chunk is absent');
			const nextReceivedBytes = receivedBytes + chunk.value.byteLength;
			if (nextReceivedBytes > expectedBytes)
				throw new Error('Browser artifact response exceeds expected size');
			binary.set(chunk.value, receivedBytes);
			receivedBytes = nextReceivedBytes;
			if (
				receivedBytes === expectedBytes ||
				receivedBytes - reportedBytes >= progressReportIntervalBytes
			) {
				reportProgress?.(transferProgress(receivedBytes, expectedBytes));
				reportedBytes = receivedBytes;
			}
		}
	} catch (cause) {
		await reader.cancel(cause).catch(() => undefined);
		throw cause;
	} finally {
		reader.releaseLock();
	}
	if (receivedBytes !== expectedBytes)
		throw new Error('Browser artifact response size differs');
	if (reportedBytes !== receivedBytes)
		reportProgress?.(transferProgress(receivedBytes, expectedBytes));
	return binary;
}

function transferProgress(
	networkReceivedBytes: number,
	totalBytes: number,
): ContentArtifactLoadProgress {
	return contentArtifactLoadProgress({
		stage: 'transfer',
		stageCompleted: false,
		networkReceivedBytes,
		transferredBytes: 0,
		totalBytes,
	});
}
