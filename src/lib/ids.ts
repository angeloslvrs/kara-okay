import { randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

export function newToken(): string {
  return randomUUID().replace(/-/g, '');
}
