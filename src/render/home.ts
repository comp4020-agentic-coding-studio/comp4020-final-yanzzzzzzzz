import { layout } from "./layout.ts";

export function homePage(): string {
  return layout(
    "Turtle Soup Puzzle Room",
    `
    <section class="hero">
      <h1>Turtle Soup Puzzle Room</h1>
      <p>
        The AI knows the whole truth, and only ever gives you one cryptic premise.
        Everyone in the room shares the same transcript — ask yes/no questions,
        the AI rules on them in real time, and the answer broadcasts live to
        everyone in the room. Reason together, solve the case together.
      </p>
      <form method="post" action="/rooms">
        <button type="submit">Start a new case</button>
      </form>
    </section>
    `,
  );
}
