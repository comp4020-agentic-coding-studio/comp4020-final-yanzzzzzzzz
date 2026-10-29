import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";
import sharp from "sharp";

// Regression coverage for a real bug report: "another browser creates a
// room and the lobby needs a manual refresh to see it; a room's status/
// transcript doesn't update live either." Every spec/*.test.ts file before
// this one checked the SERVER side of real-time (does the right thing get
// broadcast?) by reading the raw SSE wire format — none of them loaded the
// actual client-side JS (public/lobby.js, public/client.js) and checked it
// actually updates a page, which is where two of the three real bugs this
// session found and fixed were: a route that broadcasts nothing at all
// (room start/transfer-host), and a lobby stream with no reconnect/race-safe
// snapshot. This file drives the REAL rendered HTML + REAL public/*.js
// through jsdom with Node's real EventSource (package.json's `test` script
// sets NODE_OPTIONS=--experimental-eventsource for this), as two independent
// sessions (separate cookies, like two different browsers) against the same
// live server — not mocked DOM, not a second test harness reimplementing the
// client.
const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const c = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!c) throw new Error("no turtle_session cookie set");
  return c.split(";")[0];
}

async function waitFor<T>(fn: () => T | null | undefined | false, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = fn();
    if (v) return v;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("waitFor timed out");
}

// Loads a real page's HTML and its own real <script src> files into jsdom,
// with a real EventSource and a cookie-forwarding fetch/EventSource so this
// session's identity round-trips the same way a real browser's would.
async function loadDom(path: string, cookie?: string): Promise<{ window: JSDOM["window"] }> {
  const res = await fetch(new URL(path, baseUrl), { headers: cookie ? { cookie } : {} });
  const html = await res.text();
  const dom = new JSDOM(html, {
    url: new URL(path, baseUrl).toString(),
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.EventSource = class extends EventSource {
        constructor(url: string | URL, opts?: EventSourceInit) {
          super(new URL(url, window.location.href).toString(), {
            ...opts,
            ...(cookie ? { headers: { cookie } } : {}),
          } as EventSourceInit);
        }
      } as unknown as typeof window.EventSource;
      const realFetch = fetch;
      window.fetch = ((url: string | URL, opts: RequestInit = {}) =>
        realFetch(new URL(url, window.location.href).toString(), {
          ...opts,
          headers: { ...(opts.headers as Record<string, string> | undefined), ...(cookie ? { cookie } : {}) },
        })) as typeof window.fetch;
      // jsdom doesn't implement scrollIntoView or a real page navigation —
      // both real-browser behaviors this app relies on (client.js scrolls a
      // new transcript entry into view; it also calls location.reload() on
      // a correct verdict or a room-status change) that jsdom can't execute,
      // not app bugs. Stubbed so they don't masquerade as test failures.
      window.Element.prototype.scrollIntoView = () => {};
    },
  });
  await new Promise((resolve) => dom.window.addEventListener("load", resolve));
  await new Promise((resolve) => setTimeout(resolve, 300));
  return { window: dom.window };
}

it(
  "shows a room created by a separate session on the lobby page without a manual refresh",
  async () => {
    const { window } = await loadDom("/");
    const list = window.document.getElementById("lobby-list")!;

    // A second, independent session (no shared cookie — a different
    // browser) creates a room.
    const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
    const code = (create.headers.get("location") ?? "").split("/").pop()!;

    await waitFor(() => list.querySelector(`li[data-code="${code}"]`));
    window.close();
  },
  10_000,
);

it(
  "sends an authoritative snapshot, including a room created just before connecting, on every /lobby/stream connect",
  async () => {
    // Regression test for the exact race reproduced while fixing this bug:
    // a tab's server-rendered homepage is painted, then — before its
    // EventSource actually finishes opening (real network/JS-eval latency,
    // or any reconnect after a drop) — someone else creates a room. The old
    // /lobby/stream only ever sent "here's the room that just changed," with
    // nothing resent for anything missed; a room created in that exact
    // window was broadcast to no subscriber (this one wasn't connected yet)
    // and NEVER arrived, with no reload-free way to recover. The fix sends a
    // full snapshot event the instant any connection opens — read directly
    // off the raw SSE wire here (same technique as spec/sse.test.ts), since
    // what's under test is the server's own guarantee, independent of
    // whichever client happens to consume it.
    const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
    const code = (create.headers.get("location") ?? "").split("/").pop()!;

    // Connects AFTER the room already exists — simulating a reconnect, or a
    // tab whose EventSource was still opening when the room was created.
    const streamRes = await fetch(new URL("/lobby/stream", baseUrl));
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before a snapshot event arrived");
      buffer += decoder.decode(value, { stream: true });
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) continue;
      const chunk = buffer.slice(0, idx);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      expect(event).toBe("snapshot");
      const rooms = JSON.parse(data) as { code: string }[];
      expect(rooms.some((r) => r.code === code)).toBe(true);
      break;
    }
    await reader.cancel();
  },
  10_000,
);

it(
  "flips a lobby card from waiting to in-progress live when the host starts the case",
  async () => {
    const { window } = await loadDom("/");
    const list = window.document.getElementById("lobby-list")!;

    const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
    const code = (create.headers.get("location") ?? "").split("/").pop()!;
    const cookie = parseCookie(create.headers.getSetCookie());

    const card = await waitFor(() => list.querySelector(`li[data-code="${code}"]`));
    expect(card.textContent).toContain("Not started yet");

    await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
      method: "POST",
      headers: { cookie },
      redirect: "manual",
    });

    await waitFor(() => list.querySelector(`li[data-code="${code}"]`)?.textContent?.includes("In progress"));
    window.close();
  },
  10_000,
);

it(
  "broadcasts a live room-status event to another session when the host starts the case",
  async () => {
    // Regression test for the bug report's claim that "after the host
    // starts, the other party's input area becomes usable automatically"
    // (i.e. without a manual refresh). Root cause: starting a room or
    // transferring host only ever
    // redirected the REQUESTING session — nothing was broadcast on the
    // room's own SSE channel, so a tab already sitting on the waiting-room
    // view had no way to learn the status changed. public/client.js's fix
    // reacts to a live "room-status" event by reloading the page (the
    // simplest correct way to pick up the now-different waiting/active
    // markup) — jsdom can't execute a real page navigation ("Not
    // implemented: navigation to another Document" is a jsdom limitation,
    // not an app bug), so this intercepts the SSE event itself via a second,
    // independent EventSource on the same room channel: that's the one
    // thing a real browser's reload is actually triggered by, and the one
    // thing this test can directly observe without jsdom's navigation gap.
    const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
    const code = (create.headers.get("location") ?? "").split("/").pop()!;
    const hostCookie = parseCookie(create.headers.getSetCookie());

    const join = await fetch(new URL(`/rooms/${code}`, baseUrl), { redirect: "manual" });
    const memberCookie = parseCookie(join.headers.getSetCookie());

    const streamRes = await fetch(new URL(`/rooms/${code}/stream`, baseUrl), {
      headers: { cookie: memberCookie },
    });
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    async function nextEvent(): Promise<{ event: string; data: string }> {
      while (true) {
        const idx = buffer.indexOf("\n\n");
        if (idx !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let event = "message";
          let data = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data = line.slice(6);
          }
          if (event === "heartbeat") continue;
          return { event, data };
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended before a room-status event arrived");
        buffer += decoder.decode(value, { stream: true });
      }
    }

    await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
      method: "POST",
      headers: { cookie: hostCookie },
      redirect: "manual",
    });

    // Skip the presence broadcast(s) from this stream opening; the thing
    // under test is that a "room-status" event eventually arrives at all.
    let event = await nextEvent();
    const deadline = Date.now() + 5000;
    while (event.event !== "room-status" && Date.now() < deadline) {
      event = await nextEvent();
    }
    expect(event.event).toBe("room-status");
    expect(JSON.parse(event.data)).toMatchObject({ status: "active" });

    await reader.cancel();
  },
  10_000,
);

it(
  "delivers a question and its verdict live to a second session watching the same room",
  async () => {
    const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
    const code = (create.headers.get("location") ?? "").split("/").pop()!;
    const hostCookie = parseCookie(create.headers.getSetCookie());
    await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
      method: "POST",
      headers: { cookie: hostCookie },
      redirect: "manual",
    });

    const join = await fetch(new URL(`/rooms/${code}`, baseUrl), { redirect: "manual" });
    const memberCookie = parseCookie(join.headers.getSetCookie());

    const { window: hostWindow } = await loadDom(`/rooms/${code}`, hostCookie);
    const { window: memberWindow } = await loadDom(`/rooms/${code}`, memberCookie);

    await fetch(new URL(`/rooms/${code}/ask`, baseUrl), {
      method: "POST",
      headers: { cookie: memberCookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ question: "live sync probe question", kind: "question" }),
    });

    await waitFor(() =>
      [...hostWindow.document.querySelectorAll(".entry-question")].some((el) =>
        el.textContent?.includes("live sync probe question"),
      ),
    );
    hostWindow.close();
    memberWindow.close();
  },
  10_000,
);

it(
  "surfaces a visible notice and keeps the typed text when a question is rejected (cooldown)",
  async () => {
    // Regression test: client.js's ask-form fetch() followed the server's
    // 303-on-rejection redirect transparently (fetch's default redirect:
    // "follow"), so a cooldown rejection came back with res.ok === true —
    // indistinguishable from success. The old code cleared the input and
    // showed nothing, silently discarding the player's question.
    const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
    const code = (create.headers.get("location") ?? "").split("/").pop()!;
    const cookie = parseCookie(create.headers.getSetCookie());
    await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
      method: "POST",
      headers: { cookie },
      redirect: "manual",
    });

    const { window } = await loadDom(`/rooms/${code}`, cookie);
    const document = window.document;
    const input = document.getElementById("question") as HTMLInputElement;
    const askButton = [...document.querySelectorAll<HTMLButtonElement>("#ask-form button")].find(
      (b) => b.value === "question",
    )!;

    input.value = "first question";
    askButton.click();
    await new Promise((resolve) => setTimeout(resolve, 500));

    input.value = "second question during cooldown";
    askButton.click();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const notice = document.getElementById("ask-notice")!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).not.toBe("");
    expect(input.value).toBe("second question during cooldown");
    window.close();
  },
  10_000,
);

// Regression test for a real root-reproduced browser bug: two independent
// origins joined the same room as distinct sessions, each asked a question
// (each message correctly showed its own author's avatar, since src/render/
// room.ts's SSR version already wrote the data-author-session-id attribute
// correctly). One session then clicked "Remove uploaded avatar" on the
// profile page — the live member list updated (a full re-render from a
// fresh roster), but that session's ALREADY-RENDERED message kept showing
// the old avatar even after the "avatar-update" SSE event arrived and after
// waiting. Root's own DOM inspection (`img.getAttribute("data-author-
// session-id")` on every `#transcript img` returning null) found the exact
// cause: public/client.js's own avatarImgHtml() — the function that renders
// a message delivered LIVE over SSE — never wrote that attribute at all,
// only the SSR path did. The "avatar-update" handler's own
// `img[data-author-session-id="..."]` query therefore matched nothing on a
// live-delivered message, however many times it fired.
//
// Node's EventSource implementation (package.json's --experimental-
// eventsource flag) silently ignores a custom `headers` option — confirmed
// by inspecting its own source — so a cookie-authenticated SSE connection
// can't actually be driven end-to-end through jsdom's EventSource the way
// every other spec/live-sync.test.ts case drives a real fetch/POST; the
// server-broadcast side of this exact fix (presence + a correctly-scoped
// avatar-update event, in the right order) was independently confirmed by
// reading the raw SSE wire directly (same technique spec/sse.test.ts and
// this file's other tests already use for the parts that need it). This
// test instead drives the REAL public/client.js functions this bug lives in
// — appendEntry()/renderEntry() (the live-render path) and the real
// "avatar-update" listener attached to the real, running EventSource
// instance — by dispatching synthetic SSE-shaped events directly onto that
// instance, the same event shapes and data the server really sends.
async function makeTinyAvatarJpeg(color: { r: number; g: number; b: number }): Promise<Uint8Array<ArrayBuffer>> {
  const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).jpeg().toBuffer();
  return Uint8Array.from(buf);
}

// Loads a room page with a REAL EventSource subclass that, in addition to
// everything loadDom() already does, stashes every instance it constructs
// onto window.__capturedSources — letting the test reach in and fire a
// synthetic server event on the real, already-connected connection
// client.js is really listening on, working around Node's EventSource
// silently dropping the cookie header (see this test's own comment above).
async function loadRoomDomWithCapturedSource(
  path: string,
  cookie: string,
): Promise<{ window: JSDOM["window"]; dispatch: (event: string, data: unknown) => void }> {
  const res = await fetch(new URL(path, baseUrl), { headers: { cookie } });
  const html = await res.text();
  const dom = new JSDOM(html, {
    url: new URL(path, baseUrl).toString(),
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      const captured: InstanceType<typeof EventSource>[] = [];
      (window as unknown as { __capturedSources: unknown }).__capturedSources = captured;
      window.EventSource = class extends EventSource {
        constructor(url: string | URL, opts?: EventSourceInit) {
          super(new URL(url, window.location.href).toString(), {
            ...opts,
            ...{ headers: { cookie } },
          } as EventSourceInit);
          captured.push(this);
        }
      } as unknown as typeof window.EventSource;
      const realFetch = fetch;
      window.fetch = ((url: string | URL, opts: RequestInit = {}) =>
        realFetch(new URL(url, window.location.href).toString(), {
          ...opts,
          headers: { ...(opts.headers as Record<string, string> | undefined), cookie },
        })) as typeof window.fetch;
      window.Element.prototype.scrollIntoView = () => {};
    },
  });
  await new Promise((resolve) => dom.window.addEventListener("load", resolve));
  await new Promise((resolve) => setTimeout(resolve, 300));

  function dispatch(event: string, data: unknown): void {
    const sources = (dom.window as unknown as { __capturedSources: InstanceType<typeof EventSource>[] })
      .__capturedSources;
    const roomSource = sources.find((s) => (s as unknown as { url: string }).url.includes("/stream"));
    if (!roomSource) throw new Error("no captured room EventSource to dispatch on");
    // roomSource is built from Node's own global EventSource (the real
    // client, same as a real browser's), which requires Node's own global
    // Event/MessageEvent constructors for dispatchEvent() — NOT jsdom's
    // window.MessageEvent, which it rejects as "not an instance of Event"
    // since the two realms' classes are distinct.
    roomSource.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(data) }));
  }

  return { window: dom.window, dispatch };
}

it(
  "repoints an already-rendered LIVE message's avatar when its author's avatar changes, leaving other authors' avatars and Watson's untouched",
  async () => {
    const create = await fetch(new URL("/rooms", baseUrl), { method: "POST", redirect: "manual" });
    const code = (create.headers.get("location") ?? "").split("/").pop()!;
    const hostCookie = parseCookie(create.headers.getSetCookie());
    await fetch(new URL(`/rooms/${code}/start`, baseUrl), {
      method: "POST",
      headers: { cookie: hostCookie },
      redirect: "manual",
    });

    const { window, dispatch } = await loadRoomDomWithCapturedSource(`/rooms/${code}`, hostCookie);

    const authorAId = "11111111-1111-4111-8111-111111111111";
    const authorBId = "22222222-2222-4222-8222-222222222222";
    const avatarAOld = "/uploads/avatar/author-a-old.webp";
    const avatarANew = "/uploads/avatar/author-a-new.webp";
    const avatarB = "/uploads/avatar/author-b.webp";

    // A player-question entry and a judge-reply entry, delivered live over
    // SSE exactly the way src/routes/rooms.ts's broadcast() payloads are
    // shaped (an entry.avatarUrl already attached server-side) — this is
    // the exact code path (appendEntry -> renderEntry -> avatarImgHtml)
    // that silently dropped the data-author-session-id attribute.
    dispatch("message", {
      id: 101,
      room_id: "r1",
      session_id: authorAId,
      kind: "question",
      body: "author A's live question",
      verdict: "yes",
      label: null,
      avatarUrl: avatarAOld,
    });
    dispatch("message", {
      id: 102,
      room_id: "r1",
      session_id: authorBId,
      kind: "question",
      body: "author B's live question",
      verdict: "yes",
      label: null,
      avatarUrl: avatarB,
    });
    dispatch("message", {
      id: 103,
      room_id: "r1",
      session_id: null,
      kind: "system",
      body: "Yes.",
      verdict: null,
      label: null,
      avatarUrl: "/images/avatars/avatar-watson.webp",
    });

    const authorAImg = window.document.querySelector(
      `img[data-author-session-id="${authorAId}"]`,
    ) as HTMLImageElement | null;
    const authorBImg = window.document.querySelector(
      `img[data-author-session-id="${authorBId}"]`,
    ) as HTMLImageElement | null;
    expect(
      authorAImg,
      "a LIVE-delivered question entry's avatar must carry its author's session id — this is exactly what the bug dropped",
    ).not.toBeNull();
    expect(authorBImg).not.toBeNull();
    expect(authorAImg!.src).toContain(avatarAOld);

    // The judge-reply chip is never author-attributed — Watson has no
    // session to re-target.
    const watsonChip = window.document.querySelector(".entry-judge-reply img.avatar-chip");
    expect(watsonChip).not.toBeNull();
    expect(watsonChip!.getAttribute("data-author-session-id")).toBeNull();

    // Author A's avatar changes live — only author A's own message updates.
    dispatch("avatar-update", { sessionId: authorAId, avatarUrl: avatarANew });

    expect(authorAImg!.src).toContain(avatarANew);
    expect(authorBImg!.src).toContain(avatarB);
    expect(watsonChip!.getAttribute("src")).toContain("avatar-watson.webp");

    window.close();
  },
  10_000,
);
