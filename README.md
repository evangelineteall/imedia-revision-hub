# RTS Behaviour Dashboard

Live version of the SLT pitch demo, hosted on Cloudflare Pages, refreshed
weekly from Arbor.

## How it works

- `index.html` is the site. On load it tries to fetch `data/live.json`; if
  that succeeds, "This week" shows the real figures inside it. If it's
  missing or fails to load, the page quietly falls back to a bundled sample
  snapshot, so the page always works.
- `data/live.json` is rebuilt automatically once a week (Mondays, 06:00 UTC)
  by the GitHub Action in `.github/workflows/refresh-data.yml`, which runs
  `scripts/fetch-data.js`.
- `scripts/fetch-data.js` fetches RTS's four Arbor "data-export" links,
  parses each one's table, and (for the Behaviour export) works out
  Positive/Negative/Neutral and category for every incident using
  `data/behaviour-values.json` - RTS's own 44 real incident names.
- The four Arbor links themselves are never committed to this repository.
  They live only as GitHub Actions repository secrets
  (`ARBOR_BEHAVIOUR_URL`, `ARBOR_LATE_URL`, `ARBOR_DETENTIONS_URL`,
  `ARBOR_SUSPENSIONS_URL`) and are passed to the script as environment
  variables at run time.

## Running a refresh manually

Repo -> **Actions** tab -> **Refresh live data** -> **Run workflow**. Useful
for testing before the first scheduled Monday run, or any time you want an
up-to-date snapshot without waiting for the schedule.

## What's live vs. still sample

Real once this is running: This week's totals, the daily trend, the
category breakdown, the top incident types, and the individual student
totals (all sourced from the Behaviour export).

Still illustrative/sample: Full year, By year group, By house, Pupil
Premium vs non-PP, By subject, By department, the 3-year trend, and Lesson
exits. Year Group and House aren't in the Behaviour export at all yet (a
separate student-roster export would be needed to add them for real); the
Late/Detentions/Suspensions data is fetched and saved in `data/live.json`
each week but isn't wired into any chart yet - that's a good next step once
we agree what each should show.

## Safeguarding note

This site will show real, named pupil behaviour data once it's live -
that's the whole point of it working. Cloudflare Access should be switched
on and restricted to the school's email domain **before** telling anyone
the URL. Don't share the link with anyone until that's confirmed working.
