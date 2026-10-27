// Seed bank of classic 海龟汤 (lateral-thinking / "turtle soup") puzzles,
// written natively in Chinese — see PROCESS.md for why the English originals
// now only exist in src/db.ts as a one-time migration-matching table, not here.
export interface SeedPuzzle {
  // A stable identity for reconciling this entry against a row already on
  // disk — NOT derived from the title/premise/solution text, specifically so
  // translating or lightly rewording an entry updates the existing row in
  // place instead of looking like a brand new puzzle. See db.ts's
  // reconcileSeedPuzzles().
  slug: string;
  title: string;
  premise: string;
  solution: string;
}

// Titles name the setup, not the twist — a case card should tempt someone
// into opening a case, not spoil it.
export const SEED_PUZZLES: SeedPuzzle[] = [
  {
    slug: "turtle-soup-bowl",
    title: "一碗海龟汤",
    premise:
      "一个男人走进餐厅，点了一碗海龟汤。喝了一口之后，他回到座位，掏出一把枪自杀了。为什么？",
    solution:
      "多年前，这个男人遭遇海难，与同伴失散，靠吃一位已经死去的同伴留下的“海龟肉”才活了下来——但那其实是另一位遇难同伴的肉，他当时并不知情。如今第一次尝到真正的海龟汤，他发现味道和当年吃的完全不同，终于明白自己当年究竟靠什么活了下来，无法承受这个真相，于是开枪自尽。",
  },
  {
    slug: "silent-phone-call",
    title: "午夜无声电话",
    premise: "一个女人深夜听到电话铃响。她接起电话，一言不发，挂断后立刻报了警。为什么？",
    solution:
      "她和丈夫事先约定好：如果深夜接到一通没有声音的电话，就代表丈夫身陷险境、无法说话，但还是设法拨通了这个暗号号码求救。她一听到那片沉默，立刻明白发生了什么，马上报了警。",
  },
  {
    slug: "elevator-routine",
    title: "电梯里的习惯",
    premise:
      "一个男人住在十楼。每天早上他乘电梯直达一楼去上班，但每天傍晚回家时，他只乘电梯到七楼，剩下的路自己走上去——除非下雨天，他才会直接乘电梯到十楼。为什么？",
    solution:
      "他是一个身材矮小的人，站在电梯里只能按到七楼的按钮。下雨天他会带伞，用伞尖够到十楼的按钮，所以才能一路坐到家。",
  },
  {
    slug: "desert-parachute",
    title: "沙漠里的降落伞",
    premise: "沙漠中发现一具尸体，旁边放着一顶没有打开的降落伞和一根火柴。他是怎么死的？",
    solution:
      "他和几名乘客乘坐的飞机出了故障，必须跳伞逃生，但降落伞的数量不够分。他们抽签决定谁能拿到降落伞，他抽到了那根火柴，意味着他没有伞，还是跳了下去，落地时摔死了。",
  },
  {
    slug: "avoided-gas-station",
    title: "绕路的加油站",
    premise:
      "一个男人每天开车往返两座城市之间，却从不在路上一家加油站停车加油——尽管那是离他家最近、油价也最便宜的一家。为什么？",
    solution:
      "那家加油站的老板曾经和他的妻子有过一段婚外情。他无法原谅这件事，宁愿绕远路、多花钱，也绝不会去那里加油。",
  },
  {
    slug: "discarded-shoes",
    title: "被扔掉的新鞋",
    premise: "一个女人买了一双新鞋，一回到家就把它们直接扔进了垃圾桶。为什么？",
    solution:
      "她特意为一场重要的活动买了这双鞋，但就在活动当天，她的脚严重扭伤，不得不截肢。这双鞋如今只会让她想起那只已经不在的脚，于是她把它们扔掉了。",
  },
  {
    slug: "man-and-straw",
    title: "握着吸管的男人",
    premise: "一个男人被发现倒在地上死去，手里紧紧攥着一根吸管，周围没有任何打斗的痕迹。他是怎么死的？",
    solution:
      "他是一名潜水员，靠一根连接水面浮标的吸管状软管呼吸。有人把那个浮标当作纪念品偷走了，导致海水灌进软管，他在水下窒息溺亡。",
  },
  {
    slug: "dinner-party-soup",
    title: "晚宴上的那碗汤",
    premise: "一对夫妻举办了一场晚宴。一位客人喝了一口汤，便默默起身离席，第二天就提出了离婚。为什么？",
    solution:
      "多年前，这位客人曾和前妻一起喝过用同一个配方做的汤——那是前妻的拿手菜，她一直称之为“爱情配方”。尝到这顿晚宴上的汤做法完全不同，他才意识到，自己的妻子其实从未真正用过那个配方招待过他，由此断定这段婚姻从一开始就不是他以为的样子。",
  },
];
