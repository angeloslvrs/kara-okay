import type { DB } from '@/lib/db';
import { openMemoryDb, setDbForTest } from '@/lib/db';

export function freshDb(): DB {
  const db = openMemoryDb();
  setDbForTest(db);
  return db;
}
