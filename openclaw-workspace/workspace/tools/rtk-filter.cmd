@echo off
REM rtk-filter.cmd ? ??????RTK??
REM ??: rtk-filter.cmd <command> [args...]
REM rtk 需在 PATH 中；若不在 PATH，改为其完整路径（如 %CARGO_HOME%\bin\rtk.exe）
set RTK=rtk
set CMD=%1
shift
:loop
if "%1"=="" goto run
set ARGS=%ARGS% %1
shift
goto loop
:run
"%RTK%" %CMD%%ARGS% 2>&1
exit /b %ERRORLEVEL%
