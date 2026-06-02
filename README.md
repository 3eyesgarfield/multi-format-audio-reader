# Polyglot Reader — 多格式有声阅读器

本地桌面阅读器：打开 **PDF / Markdown / EPUB**，用本地/中英友好的 AI 语音朗读，
支持倍速、搜索、逐句高亮、词典、生词本、有声书导出等。

- **朗读引擎**：Microsoft **Huihui** (SAPI，零配置) + **Kokoro**（本地神经，中英双语，
  GPU 加速）+ **Edge-TTS**（在线，中英极佳）。可随时切换，支持中英自动切换音色。
- **架构**：Electron (React + TS) 前端 + Python (FastAPI) TTS sidecar。

## 环境要求

- Node ≥ 20、Python ≥ 3.10、[uv](https://github.com/astral-sh/uv)
- Windows（Huihui SAPI 与媒体键依赖 Windows）
- 可选：NVIDIA GPU（Kokoro 加速；RTX 50 系需 CUDA 12.8 轮子）

## 安装

```powershell
# 1) 前端依赖
npm install

# 2) 后端核心依赖（SAPI + Edge + 导出已可用）
cd backend
uv venv --python 3.12
uv pip install -e .
cd ..

# 3) （可选）本地神经 TTS + OCR —— 启用 Kokoro 与扫描版 PDF 识别
cd backend
./install-optional.ps1
cd ..

# 4) （可选）离线词典：把 cedict_ts.u8 放到 resources/dict/
```

## 运行

```powershell
npm run dev      # 开发模式（热重载，自动拉起 TTS sidecar）
npm run build    # 生产构建
npm run dist:win # 打包成 Windows 安装包 (electron-builder)
```

也可在命令行直接打开文件：`npx electron . path\to\book.pdf`

## 功能

| 类别 | 功能 |
|---|---|
| 阅读 | PDF/EPUB/MD 渲染、目录大纲、深色/浅色主题、字号行距、进度记忆续读 |
| PDF 版式 | 滚动 / 单页 / 双页 三种版式；缩放 ±、100%、适合宽；Ctrl+滚轮缩放；高 DPI 清晰渲染 |
| 朗读 | 三引擎切换、中英自动切换音色、倍速 0.5–3×、音调、句间停顿、逐句高亮+自动滚动、双击/点击从此处朗读 |
| 搜索 | 全文搜索、跳转定位、从命中处朗读 |
| 学习 | 划词查词（离线 CC-CEDICT）、生词本、朗读选中文本 |
| 高级 | 扫描版 PDF 双击 OCR、整本导出 mp3/wav 有声书、睡眠定时器、媒体键/快捷键 |

### 快捷键
- `空格` 播放/暂停 · `Alt+→/←` 下一句/上一句 · `Ctrl+F` 搜索
- PDF 单/双页模式：`→/←`、`PageDown/PageUp`、鼠标滚轮 翻页；`Ctrl+滚轮` 缩放
- 双击任意句子 = 从该句开始朗读
- 媒体键 播放·上一曲·下一曲 全局可用

## 目录结构

```
backend/         Python TTS sidecar（engines/ 三引擎、ocr、audio_export、server）
src/main/        Electron 主进程（窗口、IPC、sidecar、store、dictionary）
src/preload/     contextBridge IPC 桥
src/renderer/    React 前端（readers/、tts/、components/、store、i18n）
resources/dict/  离线词典放置处
```

## 备注

- 倍速通过浏览器 `playbackRate`（保持音调）即时生效，无需重新合成。
- 持久化用 `userData/reader-data.json`（书库、进度、高亮、生词本、设置）。
- Edge-TTS 需联网；Huihui、Kokoro 完全离线。
