@echo off
REM Dungeon RPG must be served over http:// - browsers refuse ES modules on file://
REM This starts a local no-cache server and opens the game.
cd /d "%~dp0"
python serve.py 8123
pause
