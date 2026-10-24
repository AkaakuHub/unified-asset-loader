export function unknownErrorMessage(cause: unknown): string {
	if (cause instanceof Error) {
		const message = cause.message.trim();
		return message.length > 0 ? message : cause.name;
	}
	if (typeof cause === 'string') {
		const message = cause.trim();
		return message.length > 0 ? message : 'unknown error';
	}
	if (isRecord(cause) && typeof cause.message === 'string') {
		const message = cause.message.trim();
		if (message.length > 0) return message;
	}
	try {
		const serialized = JSON.stringify(cause, (_key, value: unknown) =>
			typeof value === 'bigint' ? value.toString() : value,
		);
		if (serialized !== undefined && serialized.length > 0) return serialized;
	} catch {
		if (isRecord(cause))
			return `構造化error（${Object.keys(cause).join('、')}）`;
	}
	const message = String(cause);
	return message === 'undefined' ? 'unknown error' : message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
