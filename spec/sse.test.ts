import { expect, inject, it } from "vitest";

// Member-list presence: the concurrency decision for crit-9 ("whether people
// can see who else is here, and how"). Node's fetch has no EventSource, so
// these read the raw SSE wire format directly off the response body stream
// against the real running server — same test-against-a-live-server pattern
// as spec/rooms.test.ts, just reading the stream instead of a final render.
const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const sessionCookie = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!sessionCookie) throw new Error("no turtle_session cookie set");
  return sessionCookie.split(";")[0];
}

async function createRoom(): Promise<{ code: string }> {
  const res = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  return { code: location.split("/").pop() ?? "" };
}

async function visitRoom(code: string): Promise<{ cookie: string }> {
  const res = await fetch(new URL(`/rooms/${code}`, baseUrl), { redirect: "manual" });
  return { cookie: parseCookie(res.headers.getSetCookie()) };
}

async function* sseEvents(res: Response): AsyncGenerator<{ event: string; data: string }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      yield { event, data };
    }
  }
}

// Deliberately not `for await...of`: breaking out of that loop early calls
// the generator's `.return()`, which permanently closes it — the next call
// on the same generator would see `done: true` instead of resuming the
// stream. Driving `.next()` by hand keeps the generator (and the underlying
// SSE connection) alive across repeated calls.
async function nextPresence(
  gen: AsyncGenerator<{ event: string; data: string }>,
): Promise<{ online: number; members: { sessionId: string; label: string }[] }> {
  while (true) {
    const { value, done } = await gen.next();
    if (done) throw new Error("stream ended without a presence event");
    if (value.event === "presence") return JSON.parse(value.data);
  }
}

function labelsOf(members: { sessionId: string; label: string }[]): string[] {
  return members.map((m) => m.label);
}

it(
  "counts the same session's two open tabs as one person online, not two",
  async () => {
    const { code } = await createRoom();
    const { cookie } = await visitRoom(code);

    const controllerTabA = new AbortController();
    const resTabA = await fetch(new URL(`/rooms/${code}/stream`, baseUrl), {
      headers: { cookie },
      signal: controllerTabA.signal,
    });
    const genTabA = sseEvents(resTabA);
    const afterTabA = await nextPresence(genTabA);
    expect(afterTabA.online).toBe(1);

    // A second open stream for the SAME session cookie — e.g. a second
    // browser tab on the same room, not a second person.
    const controllerTabB = new AbortController();
    const resTabB = await fetch(new URL(`/rooms/${code}/stream`, baseUrl), {
      headers: { cookie },
      signal: controllerTabB.signal,
    });
    const genTabB = sseEvents(resTabB);

    const afterTabBJoins = await nextPresence(genTabA);
    expect(afterTabBJoins.online).toBe(1);
    expect(labelsOf(afterTabBJoins.members)).toEqual(["Anonymous Detective#1"]);
    await nextPresence(genTabB); // tab B's own connect-time broadcast

    // Closing one of the two tabs still leaves the session's other tab
    // connected, so the online count stays at 1, not 0.
    controllerTabA.abort();
    const afterTabACloses = await nextPresence(genTabB);
    expect(afterTabACloses.online).toBe(1);

    controllerTabB.abort();
  },
  10_000,
);

it(
  "shows a live member list that updates as people join and leave",
  async () => {
    const { code } = await createRoom();
    const { cookie: cookieA } = await visitRoom(code);
    const { cookie: cookieB } = await visitRoom(code);

    const controllerA = new AbortController();
    const resA = await fetch(new URL(`/rooms/${code}/stream`, baseUrl), {
      headers: { cookie: cookieA },
      signal: controllerA.signal,
    });
    const genA = sseEvents(resA);

    const onA = await nextPresence(genA);
    expect(labelsOf(onA.members)).toEqual(["Anonymous Detective#1"]);

    const controllerB = new AbortController();
    const resB = await fetch(new URL(`/rooms/${code}/stream`, baseUrl), {
      headers: { cookie: cookieB },
      signal: controllerB.signal,
    });
    const genB = sseEvents(resB);

    // B joining broadcasts a fresh roster to every open connection, A included.
    const afterBJoins = await nextPresence(genA);
    expect(labelsOf(afterBJoins.members).sort()).toEqual([
      "Anonymous Detective#1",
      "Anonymous Detective#2",
    ]);
    await nextPresence(genB); // B's own connect-time broadcast, same payload

    controllerB.abort();
    const afterBLeaves = await nextPresence(genA);
    expect(labelsOf(afterBLeaves.members)).toEqual(["Anonymous Detective#1"]);

    controllerA.abort();
  },
  10_000,
);
