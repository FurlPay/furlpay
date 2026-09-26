@echo off
REM ChainTracker Pro - Bitcoin mempool surface.
REM
REM   run-mempool.cmd watch    resident watcher: walks every new block, samples
REM                            the mempool, posts whale and exploit alerts,
REM                            keeps the pinned board live. This is the one
REM                            that makes the whale feed complete.
REM   run-mempool.cmd daily    edits the board and posts the 24h digest.
REM   run-mempool.cmd once     a single tick, for a scheduler.
REM   run-mempool.cmd doctor   what answers, what is stored. No writes.
REM
REM THE TASK MUST POINT AT THIS FILE, NOT AT node.exe - same reason as
REM run-daily.cmd. Task Scheduler cannot redirect a process's output, so an
REM action of "node.exe dist\mempool.js watch" discards every log line and a
REM failure leaves nothing on disk but a LastTaskResult code.
REM
REM For the watcher, create the task with:
REM   - Trigger: At log on  (it is resident, not periodic)
REM   - Action:  cmd.exe /c "run-mempool.cmd watch"
REM   - Settings: restart every 5 minutes, up to 3 times
REM   - UNTICK "Stop the task if it runs longer than ..." - the default 3 days
REM     would kill the watcher and leave a coverage gap with no explanation.

cd /d "%~dp0"
if not exist data mkdir data

REM Keep the log bounded. The watcher writes far more than the daily job, so
REM this rotates at 8 MB rather than 2.
for %%A in ("data\mempool.log") do if %%~zA GTR 8388608 (
  move /y "data\mempool.log" "data\mempool.log.1" >nul
)

echo. >> data\mempool.log
echo ======== %~1 started %DATE% %TIME% ======== >> data\mempool.log
node dist\mempool.js %* >> data\mempool.log 2>&1
set RC=%ERRORLEVEL%
echo ======== %~1 finished %DATE% %TIME% exit=%RC% ======== >> data\mempool.log

exit /b %RC%
