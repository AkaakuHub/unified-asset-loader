const databases = new Map<string, Promise<IDBDatabase>>();
const totalKey = 'total';

function openDatabase(directory: string): Promise<IDBDatabase> {
	const existing = databases.get(directory);
	if (existing !== undefined) return existing;
	const opening = new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(`ual-opfs-usage:${directory}`, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore('sizes');
			request.result.createObjectStore('pending', { autoIncrement: true });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	databases.set(directory, opening);
	return opening;
}

function read<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function committed(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error);
	});
}

function usageLock(directory: string): string {
	return `ual-opfs-usage:${directory}`;
}

export async function readBrowserOpfsUsage(directory: string): Promise<number> {
	return navigator.locks.request(usageLock(directory), async () => {
		const db = await openDatabase(directory);
		const transaction = db.transaction(['sizes', 'pending']);
		const pending = transaction.objectStore('pending');
		const [current, keys, changes] = await Promise.all([
			read<number | undefined>(transaction.objectStore('sizes').get(totalKey)),
			read(pending.getAllKeys()),
			read<string[][]>(pending.getAll()),
		]);
		if (current !== undefined && keys.length === 0) return current;
		const storage = await navigator.storage.getDirectory();
		const root = await storage.getDirectoryHandle(directory, { create: true });
		if (current !== undefined) {
			return await recordSizes(
				db,
				await readFileSizes(root, [...new Set(changes.flat())]),
				keys,
			);
		}
		const sizes = new Map<string, number>();
		await walk(root, '', sizes);
		const update = db.transaction(['sizes', 'pending'], 'readwrite');
		const done = committed(update);
		const store = update.objectStore('sizes');
		let total = 0;
		for (const [path, size] of sizes) {
			total += size;
			store.put(size, path);
		}
		store.put(total, totalKey);
		update.objectStore('pending').clear();
		await done;
		return total;
	});
}

export async function trackBrowserOpfsUsage<T>(
	directory: string,
	root: FileSystemDirectoryHandle,
	scope: string,
	paths: readonly string[],
	mutate: () => Promise<T>,
): Promise<T> {
	const lock = usageLock(directory);
	return navigator.locks.request(lock, { mode: 'shared' }, () =>
		navigator.locks.request(`${lock}:${scope}`, async () => {
			const db = await openDatabase(directory);
			const current = await read<number | undefined>(
				db.transaction('sizes').objectStore('sizes').get(totalKey),
			);
			if (current === undefined) return await mutate();
			const transaction = db.transaction('pending', 'readwrite');
			const done = committed(transaction);
			const [key] = await Promise.all([
				read(transaction.objectStore('pending').add(paths)),
				done,
			]);
			try {
				return await mutate();
			} finally {
				await recordSizes(db, await readFileSizes(root, paths), [key]);
			}
		}),
	);
}

async function recordSizes(
	db: IDBDatabase,
	changes: ReadonlyMap<string, number>,
	journalKeys: readonly IDBValidKey[],
): Promise<number> {
	const transaction = db.transaction(['sizes', 'pending'], 'readwrite');
	const done = committed(transaction);
	const store = transaction.objectStore('sizes');
	const paths = [...changes.keys()];
	const [total, ...sizes] = await Promise.all(
		[totalKey, ...paths].map((key) => read<number | undefined>(store.get(key))),
	);
	let updated = total ?? 0;
	for (const [index, path] of paths.entries()) {
		const size = changes.get(path) ?? 0;
		updated += size - (sizes[index] ?? 0);
		if (size === 0) store.delete(path);
		else store.put(size, path);
	}
	store.put(updated, totalKey);
	const pending = transaction.objectStore('pending');
	for (const key of journalKeys) pending.delete(key);
	await done;
	return updated;
}

async function walk(
	directory: FileSystemDirectoryHandle,
	prefix: string,
	sizes: Map<string, number>,
): Promise<void> {
	for await (const [name, handle] of directory.entries()) {
		if (handle.kind === 'directory')
			await walk(handle, `${prefix}${name}/`, sizes);
		else sizes.set(`/${prefix}${name}`, (await handle.getFile()).size);
	}
}

async function readFileSizes(
	root: FileSystemDirectoryHandle,
	paths: readonly string[],
): Promise<ReadonlyMap<string, number>> {
	const sizes = await Promise.all(
		paths.map(async (path) => {
			const components = path.split('/');
			components.shift();
			const name = components.pop();
			if (!name) throw new Error('OPFS usage path is invalid');
			try {
				let directory = root;
				for (const component of components)
					directory = await directory.getDirectoryHandle(component);
				const file = await directory.getFileHandle(name);
				return [path, (await file.getFile()).size] as const;
			} catch (error) {
				if (error instanceof DOMException && error.name === 'NotFoundError')
					return [path, 0] as const;
				throw error;
			}
		}),
	);
	return new Map(sizes);
}
