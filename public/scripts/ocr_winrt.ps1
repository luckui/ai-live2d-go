# WinRT OCR 脚本
# 用法: powershell -File ocr_winrt.ps1 -ImagePath <png路径> [-Query <文字>] [-PartialMatch]
#
# 输出: JSON 数组，每项为匹配的 Line 区域:
#   { text, x, y, w, h, cx, cy }
#   x/y 是该 Line 的左上角（物理像素），cx/cy 是中心点
#
# Query 未传时: 返回所有 Line（每行合并文字）
# Query 传了:   返回包含该文字的 Line（每行文字合并后做包含匹配）
#
# 注意: 坐标为截图物理像素坐标，调用方需自行换算为逻辑像素
# 依赖: Windows 10/11 内置 WinRT，无需安装任何包

param(
    [Parameter(Mandatory)][string]$ImagePath,
    [string]$Query = "",
    [switch]$PartialMatch
)

function Fail([string]$msg) {
    Write-Output (@{ error = $msg } | ConvertTo-Json -Compress)
    exit 1
}

# ── 加载 WinRT 异步帮助 ───────────────────────────────────────────
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
} catch {
    Fail "无法加载 System.Runtime.WindowsRuntime: $_"
}

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
    $specific = $asTaskGeneric.MakeGenericMethod($ResultType)
    $task = $specific.Invoke($null, @($WinRtTask))
    $task.Wait(-1) | Out-Null
    return $task.Result
}

# ── 加载 WinRT 类型 ────────────────────────────────────────────────
try {
    $null = [Windows.Media.Ocr.OcrEngine,            Windows.Media.Ocr,            ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging,     ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.DataWriter,     Windows.Storage.Streams,      ContentType=WindowsRuntime]
} catch {
    Fail "WinRT 类型加载失败: $_"
}

# ── 读取图片 → InMemoryRandomAccessStream ─────────────────────────
if (-not (Test-Path $ImagePath)) { Fail "图片文件不存在: $ImagePath" }

try {
    $bytes  = [System.IO.File]::ReadAllBytes($ImagePath)
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $writer = New-Object Windows.Storage.Streams.DataWriter($stream)
    $writer.WriteBytes($bytes)
    Await($writer.StoreAsync()) ([System.UInt32]) | Out-Null
    $stream.Seek(0)
    $decoder = Await([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap  = Await($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
} catch {
    Fail "图片加载失败: $_"
}

# ── 构建 OCR 引擎列表（用户配置文件语言 + 英文补充）──────────────
$engines = @()
$primaryEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($primaryEngine) { $engines += $primaryEngine }

try {
    $engLang   = New-Object Windows.Globalization.Language("en")
    $engEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($engLang)
    if ($engEngine -and (!$primaryEngine -or $primaryEngine.RecognizerLanguage.LanguageTag -ne 'en')) {
        $engines += $engEngine
    }
} catch {}

if ($engines.Count -eq 0) { Fail "没有可用的 OCR 识别器，请在 Windows 设置中添加语言包" }

# ── 执行 OCR，按 Line 合并词语文字，去重 ─────────────────────────
# WinRT 以单字/单词为粒度分词；这里将同一 Line 的词拼合成完整行文字，
# 以行为单位匹配 Query，更适合查找"文件"、"确定"等多字词语。
$lineList = [System.Collections.Generic.List[hashtable]]::new()
$seenKeys = [System.Collections.Generic.HashSet[string]]::new()

foreach ($engine in $engines) {
    try {
        $result = Await($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    } catch { continue }

    foreach ($line in $result.Lines) {
        # 合并行内所有词语（中文按字直接拼接，英文词间无空格也可）
        $lineText = ($line.Words | ForEach-Object { $_.Text }) -join ""
        $lineText = $lineText.Trim()
        if (-not $lineText) { continue }

        # 计算行的 BoundingRect（所有 word bbox 的并集）
        $minX = [int]::MaxValue; $minY = [int]::MaxValue
        $maxX = 0; $maxY = 0
        foreach ($word in $line.Words) {
            $b = $word.BoundingRect
            if ([int]$b.X -lt $minX)                   { $minX = [int]$b.X }
            if ([int]$b.Y -lt $minY)                   { $minY = [int]$b.Y }
            if ([int]($b.X + $b.Width)  -gt $maxX)     { $maxX = [int]($b.X + $b.Width)  }
            if ([int]($b.Y + $b.Height) -gt $maxY)     { $maxY = [int]($b.Y + $b.Height) }
        }
        $lw = $maxX - $minX
        $lh = $maxY - $minY
        $cx = [int]($minX + $lw / 2)
        $cy = [int]($minY + $lh / 2)

        # 去重：文字 + Y坐标区间（精度 8px，避免两引擎同一行重复）
        $key = "$lineText|$([int]($minY / 8))"
        if ($seenKeys.Add($key)) {
            $lineList.Add(@{
                text = $lineText
                x    = $minX
                y    = $minY
                w    = $lw
                h    = $lh
                cx   = $cx
                cy   = $cy
            })
        }
    }
}

# ── 按 Query 过滤 ─────────────────────────────────────────────────
$output = $lineList
if ($Query -ne "") {
    $q = $Query.ToLower()
    $output = @($lineList | Where-Object {
        $t = $_.text.ToLower()
        if ($PartialMatch) { $t.Contains($q) }
        else               { $t -eq $q }
    })
}

# ── 输出 JSON ─────────────────────────────────────────────────────
if ($null -eq $output -or @($output).Count -eq 0) {
    Write-Output "[]"
} else {
    Write-Output (@($output) | ConvertTo-Json -Compress)
}
