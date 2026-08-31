import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Safe read/modify/write for the shared luxury-property dataset.
//
// THE BUG THIS EXISTS TO PREVENT ALREADY HAPPENED. Every pipeline script used
// to load luxury-properties.json at start and write the whole file at the end.
// Run two at once and the second silently discards the first's work — which is
// exactly what occurred during development: the image downloader had loaded the
// dataset before the sourceNote backfill ran, then wrote its stale copy back
// over it, erasing that field from all 507 rows. A test caught it. Nothing in
// the scripts would have.
//
// TWO GUARDS, because they fail differently:
//
//   1. A LOCK, so a second script refuses to start rather than racing. Taken
//      with `wx`, which is atomic on every platform — a check-then-create would
//      have its own race, which would be a fitting way to fail here.
//
//   2. A MODIFICATION STAMP, so even a script that somehow held no lock cannot
//      overwrite a file that changed underneath it. The lock stops the common
//      case; the stamp stops the one nobody predicted.
//
// Writes go to a temp file and are renamed into place, so an interrupted run
// leaves the previous dataset intact rather than a half-written one.
// ---------------------------------------------------------------------------

export interface Held<T> {
  data: T;
  /** Write the mutated data back. Refuses if the file changed since it was read. */
  commit(next: T): void;
  /** Release without writing. */
  release(): void;
}

/**
 * How long a lock may sit before it is treated as abandoned, when its owner
 * cannot be identified. Long enough for the slowest pass — the full image
 * download runs about twenty minutes.
 *
 * This is the FALLBACK. The primary check is whether the recorded process is
 * still alive, which is exact and immediate; the timeout only covers a lock
 * written by a process on another machine or with an unreadable header.
 */
const STALE_LOCK_MS = 45 * 60_000;

/**
 * Is the process that wrote this lock still running?
 *
 * Signal 0 performs the permission and existence checks without delivering
 * anything, which is the portable way to ask. ESRCH means no such process —
 * the lock is an orphan and may be cleared immediately. EPERM means it exists
 * but belongs to another user, so it is emphatically NOT abandoned.
 *
 * Worth doing because the alternative was measured and is bad: a script killed
 * mid-run left the pipeline locked for forty-five minutes with no way to tell
 * a dead lock from a live one.
 */
function ownerAlive(pid: number): boolean | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return null;
  }
}

function lockPath(file: string): string {
  return `${file}.lock`;
}

function readStamp(file: string): number {
  return fs.statSync(file).mtimeMs;
}

/**
 * Take the lock, read the dataset, and hand back a commit function.
 *
 * Throws rather than waiting: these are interactive scripts, and a clear
 * "another script is running" beats a process that appears to hang.
 */
export function openDataset<T>(file: string, label: string): Held<T> {
  const lock = lockPath(file);

  // An abandoned lock — a script killed mid-run — must not block the pipeline
  // forever, but it also must not be cleared just because it is inconvenient.
  // Asking whether the owner is still alive answers that exactly; the age is
  // only consulted when the owner cannot be identified at all.
  if (fs.existsSync(lock)) {
    const holder = fs.readFileSync(lock, "utf8").trim();
    const pid = Number(holder.match(/pid (\d+)/)?.[1]);
    const alive = ownerAlive(pid);
    const age = Date.now() - fs.statSync(lock).mtimeMs;

    if (alive === false) {
      console.warn(`! clearing an orphaned lock — pid ${pid} is no longer running`);
      fs.rmSync(lock, { force: true });
    } else if (alive === null && age >= STALE_LOCK_MS) {
      console.warn(`! clearing a stale lock (${Math.round(age / 60_000)} min old, owner unknown)`);
      fs.rmSync(lock, { force: true });
    } else {
      throw new Error(
        `${path.basename(file)} is locked by ${holder}\n` +
          `Another pipeline script is running. Wait for it, or delete ${lock} if you are sure it died.`
      );
    }
  }

  // `wx` fails if the file exists, atomically. Two scripts starting in the same
  // millisecond cannot both win.
  const fd = fs.openSync(lock, "wx");
  fs.writeSync(fd, `${label} pid ${process.pid} since ${new Date().toISOString()}`);
  fs.closeSync(fd);

  const stampAtRead = readStamp(file);
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as T;
  let closed = false;

  const release = () => {
    if (closed) return;
    closed = true;
    process.off("exit", release);
    fs.rmSync(lock, { force: true });
  };

  // A script that throws, or is interrupted, must not leave the pipeline
  // locked behind it. `exit` fires for a normal end and for an uncaught throw;
  // the signal handlers cover Ctrl-C and a polite kill. Nothing can cover
  // SIGKILL, which is what the orphan check above is for.
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      release();
      process.exit(130);
    });
  }

  return {
    data,
    commit(next: T) {
      if (closed) throw new Error("dataset already released");
      // The second guard. If this fires, something wrote without the lock and
      // the right answer is to stop rather than to pick a winner.
      if (readStamp(file) !== stampAtRead) {
        release();
        throw new Error(
          `${path.basename(file)} changed while ${label} was running — refusing to overwrite.\n` +
            "Re-run this script against the current file."
        );
      }
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(next, null, 1));
      fs.renameSync(tmp, file);
      release();
    },
    release,
  };
}

/** Run `fn` with the dataset held, releasing the lock however it ends. */
export async function withDataset<T>(
  file: string,
  label: string,
  fn: (data: T) => Promise<T | null> | T | null
): Promise<void> {
  const held = openDataset<T>(file, label);
  try {
    const next = await fn(held.data);
    if (next) held.commit(next);
    else held.release();
  } catch (e) {
    held.release();
    throw e;
  }
}
