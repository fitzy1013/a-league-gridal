import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isTodaysGridV2 } from "@/lib/db/queries";

// Depends on today's live grid ruleset — render per request.
export const instant = false;

export const metadata = {
  title: "How to Play — A-League Grid",
};

const CLUB_SPECIFIC = [
  ["Appearances", "games played for that club (≥1 game)"],
  ["Goals", "goals scored for that club (≥1 game for the club)"],
  ["Minutes", "minutes played for that club (≥1 game)"],
  ["Yellow Cards", "yellow cards received at that club (≥1 game)"],
  ["Red Cards", "red cards received at that club (≥1 game)"],
  ["Clean Sheets (GK)", "clean sheets kept for that club (≥1 game)"],
  ["Win %", "wins with that club ÷ games for that club (≥1 game)"],
  ["Debut Age", "age when the player debuted for that club (≥1 game)"],
  ["Championships", "grand-final titles won while at that club and played ≥1 game in that winning season"],
  ["Premierships", "minor-premiership titles won while at that club and played ≥1 game in that winning season"],
  ["Era", "2-season window — must have played ≥1 game for that club in that window (e.g. Sydney FC × 2015/16-2016/17)"],
];

const CAREER_ONLY = [
  ["Golden Boot", "times won the league's top-scorer award"],
  ["Johnny Warren Medal", "times won the A-League's player-of-the-year medal"],
  ["Joe Marston Medal", "times won best-on-ground in a grand final"],
  ["Finals Apps / Finals Goals", "finals stats are tracked career-wide only"],
  ["Own Goals", "own goals are career-wide only"],
  ["Played for 2 Clubs in One Season", "played ≥1 game for two different clubs in the same season"],
  ["Seasons at One Club", "longest spell of distinct seasons at a single club"],
  ["Most Goals in a Game", "career-best single-game tally (hat-trick = 3+)"],
  ["Clubs", "how many A-League clubs the player has played for (≥1 game for each club)"],
  ["Managed By", "player just needs to be registered at the club in a season that manager was in charge"],
  ["Nationality", "nationality of the player, unchanged by clubs"],
];

export default async function RulesPage() {
  const supabase = await createClient();
  const live = await isTodaysGridV2(supabase);

  if (!live) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">How to Play</h1>
        <p className="text-sm text-muted-foreground">
          The full rules go live with tomorrow&apos;s grid, alongside some
          changes to how club-based criteria work. Check back after midnight!
        </p>
        <div>
          <Link
            href="/play/daily"
            className="text-sm font-medium underline underline-offset-4"
          >
            ← Back to today&apos;s grid
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">How to Play</h1>

      <section className="space-y-2 text-sm leading-relaxed">
        <p>
          Fill the 3×3 grid by finding a player who matches the row and column
          criteria of each cell. Every cell can have one, ten or a hundred
          correct answers — any player who genuinely fits both criteria counts.
        </p>
        <p>
          You get one guess per cell. A wrong guess locks the cell, but we&apos;ll
          tell you how close you were (e.g. &quot;scored 23 goals for Sydney FC&quot;).
        </p>
        <p>
          The daily grid rolls over at midnight Sydney time. There&apos;s also an
          unlimited practice mode with freshly generated grids.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Club × Stat cells (Career)</h2>
        <p className="text-sm leading-relaxed">
          When a cell combines a club with one of the stats below, the stat must
          have been achieved <strong>at that club specifically</strong>. For
          example, <em>Sydney FC × 20+ Goals</em> needs a player who scored 20+
          goals <strong>for Sydney FC</strong> — not across their whole career.
        </p>
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {CLUB_SPECIFIC.map(([cat, desc]) => (
            <li key={cat} className="flex flex-col rounded-md bg-accent/50 px-3 py-2">
              <span className="font-medium">{cat}</span>
              <span className="text-muted-foreground">{desc}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Career-wide categories</h2>
        <p className="text-sm leading-relaxed">
          These stay career-based even when paired with a club — so
          <em> Perth Glory × 5+ Finals Apps</em> accepts any player with 5+
          finals appearances in their career who also played for Perth Glory.
        </p>
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {CAREER_ONLY.map(([cat, desc]) => (
            <li key={cat} className="flex flex-col rounded-md bg-accent/50 px-3 py-2">
              <span className="font-medium">{cat}</span>
              <span className="text-muted-foreground">{desc}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">Good to know</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Multiple different players can be valid for the same cell.</li>
          <li>
            The official answer key never reuses the same player twice within
            one grid — and neither can you.
          </li>
          <li>
            Bands are thresholds: <em>10–30</em> means between 10 and 30,
            <em> 25+</em> means 25 or more, <em>Under 25</em> means fewer
            than 25.
          </li>
          <li>
            A-League honours in brief: the <strong>Premiership</strong> is for
            finishing top of the table after the regular season; the{" "}
            <strong>Championship</strong> is for winning the grand final.
          </li>
        </ul>
      </section>

      <div>
        <Link href="/play/daily" className="text-sm font-medium underline underline-offset-4">
          ← Back to today&apos;s grid
        </Link>
      </div>
    </div>
  );
}
