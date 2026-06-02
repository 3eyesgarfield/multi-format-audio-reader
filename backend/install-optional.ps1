# Installs the optional heavy backend features into the existing .venv:
#   - Kokoro local neural TTS (+ PyTorch with CUDA 12.8 for the RTX 5070 Ti)
#   - RapidOCR for scanned-PDF reading
#
# Run from the backend folder:  ./install-optional.ps1
$ErrorActionPreference = 'Stop'
$py = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

# Detect an NVIDIA GPU; install CUDA torch if present, else the smaller CPU build.
# cu128 wheels are forward/backward compatible across modern NVIDIA cards
# (Maxwell -> Blackwell: e.g. GTX 10-series, RTX 20/30/40/50-series).
$hasNvidia = $false
try {
  $gpus = Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name
  if ($gpus -match 'NVIDIA') { $hasNvidia = $true }
} catch {}

if ($hasNvidia) {
  Write-Host "==> NVIDIA GPU detected ($($gpus -join ', ')). Installing PyTorch CUDA 12.8..." -ForegroundColor Cyan
  & uv pip install --python $py torch --index-url https://download.pytorch.org/whl/cu128
} else {
  Write-Host '==> No NVIDIA GPU detected. Installing CPU PyTorch (Kokoro will run on CPU)...' -ForegroundColor Yellow
  & uv pip install --python $py torch --index-url https://download.pytorch.org/whl/cpu
}

Write-Host '==> Installing Kokoro + Chinese g2p (misaki[zh])...' -ForegroundColor Cyan
& uv pip install --python $py ".[kokoro]"

Write-Host '==> Installing RapidOCR (scanned PDF OCR, zh+en)...' -ForegroundColor Cyan
& uv pip install --python $py ".[ocr]"

Write-Host '==> Verifying GPU + Kokoro...' -ForegroundColor Cyan
& $py -c "import torch; print('CUDA available:', torch.cuda.is_available(), '| device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu')"
& $py -c "from kokoro import KPipeline; print('Kokoro import OK')"

Write-Host 'Done. Restart the app; Settings should now list Kokoro voices and show GPU on.' -ForegroundColor Green
