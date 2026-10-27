import { expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

function parseCookie(setCookieHeaders: string[]): string {
  const sessionCookie = setCookieHeaders.find((h) => h.startsWith("turtle_session="));
  if (!sessionCookie) throw new Error("no turtle_session cookie set");
  return sessionCookie.split(";")[0];
}

it("a chosen nickname and avatar replace the auto-label in a new room, and persist on the profile page", async () => {
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  const save = await fetch(new URL("/profile", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ nickname: "Riko", avatar: "🐢", bio: "likes soup" }),
    redirect: "manual",
  });
  expect(save.status).toBe(303);

  const profilePage = await fetch(new URL("/profile", baseUrl), { headers: { cookie } });
  const profileHtml = await profilePage.text();
  expect(profileHtml).toContain('value="Riko"');
  expect(profileHtml).toContain("likes soup");

  const createRoom = await fetch(new URL("/rooms", baseUrl), {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });
  const code = (createRoom.headers.get("location") ?? "").split("/").pop();

  const roomHtml = await (await fetch(new URL(`/rooms/${code}`, baseUrl), { headers: { cookie } })).text();
  expect(roomHtml).toContain("🐢 Riko");
  expect(roomHtml).not.toContain("匿名侦探#1");
});

it("rejects an avatar outside the fixed set rather than storing arbitrary text", async () => {
  const first = await fetch(new URL("/", baseUrl), { redirect: "manual" });
  const cookie = parseCookie(first.headers.getSetCookie());

  await fetch(new URL("/profile", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ nickname: "Casey", avatar: "<script>evil</script>" }),
    redirect: "manual",
  });

  const html = await (await fetch(new URL("/profile", baseUrl), { headers: { cookie } })).text();
  expect(html).not.toContain("<script>evil</script>");
});
