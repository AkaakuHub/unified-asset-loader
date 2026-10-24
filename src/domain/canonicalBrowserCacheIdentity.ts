const textEncoder = new TextEncoder();
const numberBytes = new Uint8Array(8);
const numberView = new DataView(numberBytes.buffer);
const initialStates = [0x811c9dc5, 0x9e3779b9, 0x85ebca77, 0xc2b2ae3d] as const;
const multipliers = [0x01000193, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f] as const;

export function createCanonicalBrowserCacheIdentity(value: unknown): string {
	const states = [...initialStates];
	encodeValue(value, states, new Set<object>());
	return states.map((state) => state.toString(16).padStart(8, '0')).join('');
}

function encodeValue(
	value: unknown,
	states: number[],
	activeObjects: Set<object>,
): void {
	if (value === undefined) {
		pushByte(states, 0);
		return;
	}
	if (value === null) {
		pushByte(states, 1);
		return;
	}
	if (value === false) {
		pushByte(states, 2);
		return;
	}
	if (value === true) {
		pushByte(states, 3);
		return;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value))
			throw new Error('Browser cache identity number must be finite');
		pushByte(states, 4);
		numberView.setFloat64(0, value, false);
		pushBytes(states, numberBytes);
		return;
	}
	if (typeof value === 'string') {
		pushByte(states, 5);
		pushBytes(states, textEncoder.encode(value));
		return;
	}
	if (typeof value !== 'object')
		throw new Error(`Browser cache identity cannot encode ${typeof value}`);
	if (activeObjects.has(value))
		throw new Error('Browser cache identity cannot encode a cycle');
	activeObjects.add(value);
	try {
		if (value instanceof Uint8Array) {
			pushByte(states, 6);
			pushBytes(states, value);
			return;
		}
		if (Array.isArray(value)) {
			pushByte(states, 7);
			pushLength(states, value.length);
			for (const entry of value) encodeValue(entry, states, activeObjects);
			return;
		}
		if (Object.getPrototypeOf(value) !== Object.prototype)
			throw new Error('Browser cache identity requires plain objects');
		const entries = Object.entries(value).toSorted(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		);
		pushByte(states, 8);
		pushLength(states, entries.length);
		for (const [key, entry] of entries) {
			pushBytes(states, textEncoder.encode(key));
			encodeValue(entry, states, activeObjects);
		}
	} finally {
		activeObjects.delete(value);
	}
}

function pushBytes(states: number[], value: Uint8Array): void {
	pushLength(states, value.byteLength);
	for (const byte of value) pushByte(states, byte);
}

function pushLength(states: number[], value: number): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff)
		throw new Error('Browser cache identity length is invalid');
	pushByte(states, value >>> 24);
	pushByte(states, value >>> 16);
	pushByte(states, value >>> 8);
	pushByte(states, value);
}

function pushByte(states: number[], value: number): void {
	for (let index = 0; index < states.length; index += 1) {
		states[index] =
			Math.imul(
				(states[index] ?? 0) ^ (value & 0xff),
				multipliers[index] ?? 1,
			) >>> 0;
	}
}
