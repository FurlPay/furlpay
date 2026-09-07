@echo off
REM FurlPay cron backstop - see README.md.
REM
REM Calls the daily endpoints again in case Vercel's Hobby-plan cron skipped
REM them. Both are idempotent: price-cards edits in place, market-brief refuses
REM a second post for a session date it has already delivered.

cd /d "%~dp0"

if not exist secret.txt (
  echo %DATE% %TIME% secret.txt missing - nothing attempted >> backstop.log
  exit /b 1
)
set /p CRONKEY=<secret.txt

for %%A in ("backstop.log") do if %%~zA GTR 2097152 (
  move /y "backstop.log" "backstop.log.1" >nul
)

echo. >> backstop.log
echo ======== backstop %DATE% %TIME% ======== >> backstop.log

for %%J in (price-cards market-brief) do (
  echo --- %%J --- >> backstop.log
  curl -s -S --max-time 120 -o "resp.tmp" -w "http=%%{http_code}\n" ^
    -H "x-furlpay-cron-key: %CRONKEY%" ^
    "https://furlpay.com/api/cron/%%J" >> backstop.log 2>&1
  type "resp.tmp" >> backstop.log
  echo. >> backstop.log
)
del /q "resp.tmp" 2>nul

echo ======== backstop finished %DATE% %TIME% ======== >> backstop.log
exit /b 0
