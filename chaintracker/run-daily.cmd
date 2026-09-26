@echo off
REM ChainTracker Pro - daily run.
REM
REM Driven by Windows Task Scheduler so nothing has to stay resident.
REM Refreshes every collector, scans for whales, edits the pinned board in
REM place and posts a fresh 24h digest into #chain-tracker.
REM
REM THE TASK MUST POINT AT THIS FILE, NOT AT node.exe. Task Scheduler cannot
REM redirect a process's output, so an action of "node.exe dist\daily.js"
REM discards everything the run printed. That is how this job failed on 6 and
REM 7 September with nothing on disk to say why - the only evidence was a
REM LastTaskResult of 0xC000013A in the scheduler's own UI. Every run now
REM leaves a timestamped block and its exit code in data\daily.log.

cd /d "%~dp0"
if not exist data mkdir data

REM Keep the log bounded. An unattended daily job appending forever is a disk
REM leak that surfaces months later; 2 MB is several weeks of runs.
for %%A in ("data\daily.log") do if %%~zA GTR 2097152 (
  move /y "data\daily.log" "data\daily.log.1" >nul
)

echo. >> data\daily.log
echo ======== run started %DATE% %TIME% ======== >> data\daily.log
node dist\daily.js %* >> data\daily.log 2>&1
set RC=%ERRORLEVEL%
echo ======== run finished %DATE% %TIME% exit=%RC% ======== >> data\daily.log

REM Surface the code to Task Scheduler so a failed run shows as failed in
REM LastTaskResult rather than as a success.
exit /b %RC%
