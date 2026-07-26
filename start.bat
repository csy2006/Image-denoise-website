@echo off
chcp 65001 > nul
echo ===================
echo  Image Denoise Website
echo  一键启动脚本
echo ===================
echo.

REM 查找 Python
set PYTHON_EXE=
where python > nul 2>&1
if %errorlevel% == 0 set PYTHON_EXE=python

if not defined PYTHON_EXE (
    where py > nul 2>&1
    if !errorlevel! == 0 set PYTHON_EXE=py
)

if not defined PYTHON_EXE (
    echo [错误] 未找到 Python，请安装 Python 后重试
    pause
    exit /b 1
)

echo [信息] 使用 Python: %PYTHON_EXE%
echo.

%PYTHON_EXE% "%~dp0start.py"

pause
