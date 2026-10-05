// Seed bank of classic 海龟汤 (lateral-thinking / "turtle soup") puzzles.
// Authored directly rather than generated at build time — see PROCESS.md for
// why.
export interface SeedPuzzle {
  premise: string;
  solution: string;
}

export const SEED_PUZZLES: SeedPuzzle[] = [
  {
    premise:
      "A man walks into a restaurant and orders a bowl of turtle soup. After one spoonful, he goes back to his seat, pulls out a gun, and shoots himself. Why?",
    solution:
      "Years earlier, the man was shipwrecked and separated from his companions, surviving by eating what he was told was turtle meat from a castaway who died — it was actually a companion's flesh, but he was never told. Tasting real turtle soup for the first time, he realized it tasted nothing like what he'd eaten back then, understood what he'd really survived on, and couldn't live with the truth.",
  },
  {
    premise:
      "A woman hears the phone ring in the middle of the night. She answers, says nothing, hangs up, and immediately calls the police. Why?",
    solution:
      "She and her husband had agreed that a silent late-night call meant he was in trouble somewhere, unable to speak, but had managed to dial the prearranged number for help. She called the police the moment she heard the silence.",
  },
  {
    premise:
      "A man lives on the 10th floor. Every morning he takes the elevator down to the ground floor for work, but every evening he only rides the elevator up to the 7th floor and walks the rest of the way — except on rainy days, when he rides it straight to the 10th. Why?",
    solution:
      "He is a dwarf who can only reach the button for the 7th floor. On rainy days he carries an umbrella, and uses its tip to press the button for the 10th floor.",
  },
  {
    premise:
      "A body is found in the desert next to an unopened parachute and a single match. How did he die?",
    solution:
      "He was one of several passengers who had to jump from a failing plane with too few parachutes to go around. They drew lots to decide who got a parachute; he drew the match, meaning he had none, and died hitting the ground after jumping anyway.",
  },
  {
    premise:
      "A man drives the same road between two cities every day, but he never stops at one particular gas station — even though it's the closest to his house and has the cheapest prices. Why?",
    solution:
      "The gas station's owner once had an affair with his wife. He can't forgive it, so he'd rather drive out of his way and pay more than ever buy gas there.",
  },
  {
    premise:
      "A woman buys a new pair of shoes, and the moment she gets home she throws them straight in the trash. Why?",
    solution:
      "She'd bought the shoes specifically for an important event, but on the day of the event she twisted her ankle badly enough to need an amputation. The shoes now only held painful memories of a foot she no longer had, so she threw them away.",
  },
  {
    premise:
      "A man is found dead on the floor, gripping a drinking straw. There's no sign of a struggle anywhere nearby. How did he die?",
    solution:
      "He was a diver who breathed through a straw-like tube connected to a floating buoy on the surface. Someone stole the buoy as a souvenir while he was underwater, letting water into the tube, and he drowned.",
  },
  {
    premise:
      "A couple hosts a dinner party. One guest takes a sip of the soup, quietly gets up and leaves, and files for divorce the next day. Why?",
    solution:
      "Years earlier, the guest had shared a bowl of soup made from the exact same recipe with his ex-wife — her signature dish, a recipe she'd always called her \"recipe for true love.\" Tasting that this soup was made completely differently from his own wife's version, he realized his wife had never actually used that recipe for him, and concluded their marriage had never been what he thought it was.",
  },
];
