type Client = { write: (chunk: string) => void; close: () => void };

// Keyed by channel name: a room id for the room transcript, or a fixed
// name like "lobby" for a sitewide channel. Same generic pub/sub either way.
const channels = new Map<string, Set<Client>>();

export function subscribe(channel: string, client: Client): () => void {
  let set = channels.get(channel);
  if (!set) {
    set = new Set();
    channels.set(channel, set);
  }
  set.add(client);
  return () => {
    set?.delete(client);
    if (set && set.size === 0) channels.delete(channel);
  };
}

export function broadcast(channel: string, id: string | number, data: unknown): void {
  const set = channels.get(channel);
  if (!set) return;
  const payload = `id: ${id}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of set) client.write(payload);
}
