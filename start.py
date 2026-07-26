#!/usr/bin/env python3
"""
Image Denoise Website - 简化启动脚本
自动启动后端和前端
"""

import os
import sys
import time
import subprocess
import webbrowser
from pathlib import Path

# 配置
SCRIPT_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = SCRIPT_DIR / "frontend"
BACKEND_EXE = SCRIPT_DIR / "server.exe"
BACKEND_PORT = 8080
FRONTEND_PORT = 8081

def log(msg):
    """纯文本日志输出（无颜色、无表情）"""
    print(msg)

def is_port_in_use(port):
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("localhost", port)) == 0

def start_backend():
    # 检查后端是否已在运行
    if is_port_in_use(BACKEND_PORT):
        log(f"后端已在运行 (localhost:{BACKEND_PORT})")
        return None

    # 检查可执行文件
    if not BACKEND_EXE.exists():
        log("=" * 60)
        log("  错误：未找到 server.exe")
        log("=" * 60)
        log("")
        log("请先编译 C++ 后端：")
        log("")
        log("  方法1：使用 MinGW")
        log("    1. 安装 MinGW-w64: https://www.mingw-w64.org/")
        log("    2. 运行：g++ -O2 -std=c++17 -o server.exe server.cpp -lws2_32")
        log("")
        log("  方法2：使用 Visual Studio")
        log("    1. 打开 Developer Command Prompt")
        log("    2. 运行：cl /O2 /std:c++17 server.cpp ws2_32.lib")
        log("")
        log("  方法3：使用在线编译器")
        log("    - 上传 server.cpp 和 stb_image.h/stb_image_write.h")
        log("    - 编译后下载 server.exe")
        log("")
        log("=" * 60)
        return None

    # 启动后端
    log("启动后端...")
    try:
        proc = subprocess.Popen(
            [str(BACKEND_EXE)],
            cwd=str(SCRIPT_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        time.sleep(1.5)
        if proc.poll() is not None:
            log(f"后端启动失败 (退出码 {proc.returncode})")
            return None
        log(f"后端启动成功 (PID {proc.pid})")
        return proc
    except Exception as e:
        log(f"启动后端失败: {e}")
        return None

def start_frontend():
    log("启动前端...")
    python_exe = sys.executable
    proc = subprocess.Popen(
        [python_exe, "-m", "http.server", str(FRONTEND_PORT), "--directory", str(FRONTEND_DIR)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    time.sleep(0.8)
    if proc.poll() is not None:
        log("前端启动失败")
        return None
    log(f"前端启动成功 (PID {proc.pid})")
    return proc

def main():
    log("=" * 60)
    log("  Image Denoise Website - 一键启动")
    log("=" * 60)
    print()

    # 启动后端
    backend_proc = start_backend()
    if backend_proc is None and not is_port_in_use(BACKEND_PORT):
        log("")
        log("后端启动失败，请按照上述说明编译 server.exe")
        input("按 Enter 退出...")
        sys.exit(1)

    print()

    # 启动前端
    frontend_proc = start_frontend()
    if frontend_proc is None:
        log("")
        log("前端启动失败")
        if backend_proc:
            backend_proc.terminate()
        input("按 Enter 退出...")
        sys.exit(1)

    print()
    log("=" * 60)
    log(f"  所有服务已启动！")
    log(f"  前端: http://localhost:{FRONTEND_PORT}")
    log(f"  后端: http://localhost:{BACKEND_PORT}")
    log("=" * 60)
    print()

    # 自动打开浏览器
    time.sleep(0.5)
    try:
        webbrowser.open(f"http://localhost:{FRONTEND_PORT}")
        log("已在浏览器中打开...")
    except Exception:
        log(f"请手动打开: http://localhost:{FRONTEND_PORT}")

    print()
    log("按 Ctrl+C 停止所有服务")
    print()

    # 等待退出
    try:
        while True:
            if backend_proc and backend_proc.poll() is not None:
                log("后端进程已退出")
                break
            time.sleep(2)
    except KeyboardInterrupt:
        print()
        log("正在停止服务...")
        if frontend_proc:
            frontend_proc.terminate()
            log("  前端已停止")
        if backend_proc:
            backend_proc.terminate()
            log("  后端已停止")
        log("")
        log("再见！")

if __name__ == "__main__":
    main()
