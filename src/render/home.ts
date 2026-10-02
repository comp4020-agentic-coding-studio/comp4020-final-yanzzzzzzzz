import { layout } from "./layout.ts";

export function homePage(): string {
  return layout(
    "海龟汤协作解谜室",
    `
    <section class="hero">
      <h1>海龟汤协作解谜室</h1>
      <p>
        AI 知道完整真相，只给出一句诡异的谜面。房间里的所有人共用同一份提问记录——
        你问的是/否问题，AI 实时裁定，答案立刻广播给房间里的每一个人。一起推理，
        一起破案。
      </p>
      <form method="post" action="/rooms">
        <button type="submit">开始新案件</button>
      </form>
    </section>
    `,
  );
}
