export class ContentAddressedArtifactRangeResponseError extends Error {
	readonly status: number;
	readonly retryable: boolean;

	constructor(input: {
		status: number;
		etag: string | null;
		contentLength: string | null;
		contentRange: string | null;
		byteLength: number;
		expectedByteLength: number;
		retryable: boolean;
	}) {
		super(
			`Content-addressed artifact Range response is invalid: status=${String(input.status)}, etag=${String(input.etag)}, content-length=${String(input.contentLength)}, content-range=${String(input.contentRange)}, bytes=${String(input.byteLength)}/${String(input.expectedByteLength)}`,
		);
		this.name = 'ContentAddressedArtifactRangeResponseError';
		this.status = input.status;
		this.retryable = input.retryable;
	}
}
