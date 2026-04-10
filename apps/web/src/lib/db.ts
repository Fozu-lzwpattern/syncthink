/**
 * 极简 IndexedDB 封装
 * 用于存储 NodeIdentity、Channel 列表、Interaction Log 等本地持久化数据
 * （Yjs 自身通过 y-indexeddb 管理画布数据，与此 DB 隔离）
 */

const DB_NAME = 'syncthink'
const STORE_NAME = 'kv'
const DB_VERSION = 1

let dbInstance: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = (e) => {
      dbInstance = (e.target as IDBOpenDBRequest).result
      resolve(dbInstance)
    }
    req.onerror = () => reject(req.error)
  })
}

export const db = {
  async get<T>(key: string): Promise<T | null> {
    const database = await openDB()
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(key)
      req.onsuccess = () => resolve((req.result as T) ?? null)
      req.onerror = () => reject(req.error)
    })
  },

  async set<T>(key: string, value: T): Promise<void> {
    const database = await openDB()
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.put(value, key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  },

  async delete(key: string): Promise<void> {
    const database = await openDB()
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.delete(key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  },

  async getAll<T>(prefix: string): Promise<T[]> {
    const database = await openDB()
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.getAllKeys()
      req.onsuccess = () => {
        const keys = (req.result as string[]).filter((k) =>
          k.startsWith(prefix)
        )
        const results: T[] = []
        let remaining = keys.length
        if (remaining === 0) {
          resolve([])
          return
        }
        keys.forEach((key) => {
          const getReq = store.get(key)
          getReq.onsuccess = () => {
            if (getReq.result !== undefined) results.push(getReq.result as T)
            remaining--
            if (remaining === 0) resolve(results)
          }
          getReq.onerror = () => reject(getReq.error)
        })
      }
      req.onerror = () => reject(req.error)
    })
  },
}
