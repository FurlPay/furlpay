# Cron backstop

Vercel Cron on the Hobby plan is **best effort**. It fires at some point within
the scheduled hour, and it silently skips days. Measured from the execution
records in KV on 2026-09-07:

| job | days missing from the last ten |
|---|---|
| `markets.brief` | Aug 28, Sep 1 |
| `ops.health` | Aug 29, Sep 1, Sep 5 |
| `brokerage.reconcile` | Sep 1, Sep 5 |

A skipped day leaves no trace anywhere — no run record, no alert, nothing in the
channel. The only way to notice is to look at a card and realise the number has
not moved, which is how the price cards stood five days stale.

This is a **backstop**, not a second scheduler. It calls the same endpoints with
`FURLPAY_CRON_SECRET` after Vercel's own window has passed. Both jobs are safe
to invoke again:

- `price-cards` **edits** its messages in place, so running it twice changes
  nothing but the timestamp.
- `market-brief` claims the session date in KV after a confirmed delivery, so a
  second invocation for the same trading day is a no-op that says so. It will
  not double-post.

That idempotence is what makes a backstop safe. Do not add a job here that
appends rather than edits, or that has no idempotency key, without giving it one
first.

## WHEN IT RUNS IS PART OF THE DESIGN, not a preference

**It must run AFTER the last Vercel window of the UTC day it is covering.** The
brief is scheduled at 21:30 UTC deliberately — an hour and a half after the US
close, because a screener queried at the bell reports the pre-auction tape as
the close. Calling it early does not just waste a request: the job builds a
brief from whatever the tape says at that moment, delivers it, and **claims the
session date**, so the real 21:30 run then correctly refuses to post. One early
call costs you that day's actual closing brief.

This was not hypothetical. On 2026-09-07 this script was run at 11:12 UTC to
test it and did exactly that — posted a "CLOSED" brief off the previous
session's numbers and claimed `2026-09-07`.

| job | Vercel schedule | window closes | safe after |
|---|---|---|---|
| `price-cards` | 13:05 UTC | 14:00 UTC | 14:00 UTC |
| `market-brief` | 21:30 UTC | 22:30 UTC | 22:30 UTC |

**23:00 UTC** clears both for the same UTC day. On this machine (IST, UTC+5:30)
that is **04:30 local**, and the UTC date at that moment is the previous
calendar day — which is exactly the session the run is covering.

If a post did go out at the wrong time, `?force=1` overrides the session claim.
That is the deliberate path for "the first post was wrong", and it is why this
script never passes it: a backstop that forces would double-post every day.

## Setup

1. Put the secret in `secret.txt` next to `run.cmd` (gitignored — the same value
   as `FURLPAY_CRON_SECRET` on the Vercel project).
2. Register the task:

   ```powershell
   $dir = "C:\Users\ashut\OneDrive\Documents\Payment App\scripts\cron-backstop"
   $action  = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c "run.cmd"' -WorkingDirectory $dir
   $trigger = New-ScheduledTaskTrigger -Daily -At '04:30'
   $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
   Register-ScheduledTask -TaskName 'FurlPay cron backstop' -Action $action -Trigger $trigger -Settings $settings
   ```

Output goes to `backstop.log`, rotated at 2 MB. `cmd.exe` cannot resolve
`run.cmd` from a working directory it was not started in, so the task sets
`-WorkingDirectory`; invoking it by absolute path (`cmd /c call "<full path>"`)
also works.
