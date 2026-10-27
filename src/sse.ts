// label/sessionId are who's connected, for channels where that's meaningful
// (a room); left undefined for channels where it isn't (the sitewide lobby).
type Client = {
  label?: string;
  sessionId?: string;
  write: (chunk: string) => void;
  close: () => void;
};

export interface Member {
  sessionId: string;
  label: string;
}

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

export function broadcast(
  channel: string,
  id: string | number,
  data: unknown,
  event?: string,
): void {
  const set = channels.get(channel);
  if (!set) return;
  const eventLine = event ? `event: ${event}\n` : "";
  const payload = `id: ${id}\n${eventLine}data: ${JSON.stringify(data)}\n\n`;
  for (const client of set) client.write(payload);
}

// How many DISTINCT SESSIONS currently hold a live connection to this
// channel — not how many open tabs/connections exist. Two tabs for the same
// anonymous session are one person sitting at one screen, so they count
// once, the same way a lobby card's "people in this room" number and a
// room's "online" count should both read as real headcount rather than
// connection count. A channel with no session concept at all (the sitewide
// lobby — see subscribe()'s Client type) has no sessions to dedupe, so every
// connection there counts as itself.
export function connectionCount(channel: string): number {
  const set = channels.get(channel);
  if (!set) return 0;
  const sessions = new Set<string>();
  let unidentified = 0;
  for (const c of set) {
    if (c.sessionId) sessions.add(c.sessionId);
    else unidentified++;
  }
  return sessions.size + unidentified;
}

// Who currently holds a live connection, one row per distinct session (not
// per tab) — same dedup rule as connectionCount, just naming the members
// instead of counting them. Keeps whichever label each session connected
// with most recently, since a label can't meaningfully differ across a
// session's own tabs.
export function listMembers(channel: string): Member[] {
  const set = channels.get(channel);
  if (!set) return [];
  const bySession = new Map<string, Member>();
  for (const c of set) {
    if (c.label && c.sessionId) bySession.set(c.sessionId, { sessionId: c.sessionId, label: c.label });
  }
  return [...bySession.values()];
}
