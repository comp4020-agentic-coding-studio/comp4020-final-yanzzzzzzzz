import type { QaEntry } from "./db.ts";

type Client = { write: (chunk: string) => void; close: () => void };

const rooms = new Map<string, Set<Client>>();

export function subscribe(roomId: string, client: Client): () => void {
  let set = rooms.get(roomId);
  if (!set) {
    set = new Set();
    rooms.set(roomId, set);
  }
  set.add(client);
  return () => {
    set?.delete(client);
    if (set && set.size === 0) rooms.delete(roomId);
  };
}

export function broadcast(roomId: string, entry: QaEntry): void {
  const set = rooms.get(roomId);
  if (!set) return;
  const payload = `id: ${entry.id}\ndata: ${JSON.stringify(entry)}\n\n`;
  for (const client of set) client.write(payload);
}
