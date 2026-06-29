type IdbValue = unknown;

const DB_NAME = 'analytics-web';
const STORE_NAME = 'kv';
const DB_VERSION = 1;

// 테스트에서 module mock store 타입을 맞추기 위한 보조 export.
export const __idbStore = new Map<string, unknown>();

function hasIndexedDb(): boolean {
	try {
		return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
	} catch {
		return false;
	}
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (!hasIndexedDb()) {
			reject(new Error('indexedDB is not available'));
			return;
		}
		const req = window.indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
	});
}

export async function idbGet<T = IdbValue>(key: string): Promise<T | null> {
	try {
		const db = await openDb();
		return await new Promise<T | null>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const store = tx.objectStore(STORE_NAME);
			const req = store.get(key);
			req.onsuccess = () => resolve((req.result as T) ?? null);
			req.onerror = () => reject(req.error ?? new Error('indexedDB get failed'));
			tx.oncomplete = () => db.close();
			tx.onabort = () => db.close();
		});
	} catch {
		return null;
	}
}

export async function idbSet(key: string, value: IdbValue): Promise<boolean> {
	try {
		const db = await openDb();
		return await new Promise<boolean>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const req = store.put(value as any, key);
			req.onsuccess = () => resolve(true);
			req.onerror = () => reject(req.error ?? new Error('indexedDB set failed'));
			tx.oncomplete = () => db.close();
			tx.onabort = () => db.close();
		});
	} catch {
		return false;
	}
}

