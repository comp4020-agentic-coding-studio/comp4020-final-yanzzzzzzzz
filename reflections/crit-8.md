# Crit 8 — It's alive!

**What was the breakthrough that moved the work forward?**

The real unlock wasn't a line of code, it was rejecting my own first five
ideas. Each one technically satisfied multi-user/real-time/persists as three
separate checkboxes, but none of them needed those properties to exist at
all — they were generic apps with a live-update feature bolted on. Naming
that pattern out loud, instead of picking the first idea that passed the
checklist, is what led to 海龟汤: a room that doesn't distinguish who asked
what isn't multiplayer, a transcript nobody sees land live isn't real-time,
a case that vanishes when the one Fly machine sleeps isn't persistent. Once
the idea needed the constraints, the rest of the build was just execution.

The second breakthrough was smaller but just as load-bearing: catching that
the course's LiteLLM proxy key is ANU-network-restricted before wiring it in
as the judge's backend, and surfacing that rather than quietly working
around it or hard-coding a fallback and hoping nobody asked.

**What did this work change about who I want to be as a software developer?**

I want to be the kind of developer who writes down the constraint the moment
I find it, not after it causes a 2am Fly deploy failure. Checking the brief
against my own plan before writing code — and asking for a steer when I
was just generating variations on the same bad idea — felt slower in the
moment and was obviously faster overall.
