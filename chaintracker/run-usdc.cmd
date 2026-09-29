@echo off
REM ---------------------------------------------------------------------------
REM USDC intelligence — Windows Task Scheduler entry point.
REM
REM WHY THIS FILE EXISTS AND WHY THE TASK MUST CALL IT. Scheduling `node` with
REM arguments directly means a crash, a bad working directory or a missing build
REM leaves NO trace anywhere — the task shows "completed" and nothing was posted.
REM This wrapper sets the working directory, captures both streams to a dated
REM log, and preserves the exit code, so a silent failure becomes a visible one.
REM Same reasoning as run-daily.cmd.
REM
REM Usage:
REM   run-usdc.cmd tick      SCAN CHAINS AND POST. This is the scheduled one.
REM   run-usdc.cmd daily     post the daily roll-up (schedule once a day)
REM   run-usdc.cmd flows     post the rolling exchange-flow summary
REM
REM   run-usdc.cmd doctor    configuration and measured coverage, posts nothing
REM   run-usdc.cmd verify    read symbol()/decimals() off chain for every contract
REM   run-usdc.cmd scan      scan only, no Discord - for checking ingestion
REM   run-usdc.cmd report    print the daily numbers without posting them
REM   run-usdc.cmd ensure    create #usdc-intelligence if absent (idempotent)
REM   run-usdc.cmd backfill  reset cursors and rescan the backfill window
REM   run-usdc.cmd probe     post one clearly-labelled synthetic embed
REM
REM SUGGESTED SCHEDULE. `tick` every 2-5 minutes and `daily` once a day. Faster
REM than ~2 minutes is not useful on public RPC: a tick already reads twelve chains
REM sequentially, and overlapping runs would fight each other for the same rate
REM limiter. There is no lock here, so do not schedule `tick` more often than one
REM run takes to finish.
REM ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"

if not exist "dist\usdc\run.js" (
  echo [run-usdc] dist\usdc\run.js is missing - running build first
  call npm run build || exit /b 1
)

if not exist "logs" mkdir "logs"
set "CMD=%~1"
if "%CMD%"=="" set "CMD=doctor"

for /f "tokens=1-3 delims=/ " %%a in ("%DATE%") do set "STAMP=%%c%%b%%a"
set "LOGFILE=logs\usdc-%CMD%-%STAMP%.log"

echo [run-usdc] %DATE% %TIME% - command: %CMD% >> "%LOGFILE%"
node dist\usdc\run.js %CMD% >> "%LOGFILE%" 2>&1
set "RC=%ERRORLEVEL%"
echo [run-usdc] exit code: %RC% >> "%LOGFILE%"

if not "%RC%"=="0" (
  echo [run-usdc] FAILED with exit code %RC% - see %LOGFILE%
)

endlocal & exit /b %RC%
