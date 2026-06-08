# ============================================================
#  SCRIPT KIEM TRA FOLDER THIEU ANH - XUAT EXCEL
#  Cau truc: Media_dong_ho -> SKU -> Anh_AVT/Anh_Hang/Anh_Tu_Chup/Video_Doc/Video_Ngang
# ============================================================

# ======= CAU HINH (SUA O DAY) =======
$rootPath = "D:\Media_Dong_Ho\I&W Carnival"

# Cac dinh dang anh hop le
$imageExtensions = @(".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif")

# Ten cac thu muc con can kiem tra
$subFolderNames = @(
    "0_Anh_AVT",
    "1_Anh_Hang",
    "2_Anh_Tu_Chup",
    "3_Video_Doc",
    "4_Video_Ngang"
)

# ======= HAM CHUYEN MAU RGB -> Excel Color (BGR Long) =======
function RGB2XL($r, $g, $b) {
    return $r + ($g * 256) + ($b * 65536)
}

# Dinh nghia mau
$clrHeaderBg   = RGB2XL 31  73  125   # xanh dam
$clrHeaderFg   = RGB2XL 255 255 255   # trang
$clrOkBg       = RGB2XL 198 239 206   # xanh la nhat
$clrOkFg       = RGB2XL 0   97  0     # xanh la dam
$clrRedBg      = RGB2XL 255 199 206   # do nhat
$clrRedFg      = RGB2XL 156 0   6     # do dam
$clrOrangeBg   = RGB2XL 255 235 205   # cam nhat
$clrOrangeFg   = RGB2XL 180 60  0     # cam dam
$clrAlt        = RGB2XL 235 241 250   # xanh nhat xen ke
$clrWhite      = RGB2XL 255 255 255   # trang
$clrBorder     = RGB2XL 200 200 200   # xam vien
$clrTitleBlue  = RGB2XL 31  73  125   # tieu de
$clrGray       = RGB2XL 128 128 128   # xam chu

# ======= KIEM TRA DUONG DAN =======
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  KIEM TRA FOLDER THIEU FILE ANH" -ForegroundColor Cyan
Write-Host "  Thu muc goc: $rootPath" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $rootPath)) {
    Write-Host "LOI: Khong tim thay thu muc: $rootPath" -ForegroundColor Red
    Write-Host "Vui long sua bien rootPath trong script!" -ForegroundColor Yellow
    pause
    exit
}

# ======= HAM KIEM TRA ANH =======
function Has-ImageFiles($folderPath) {
    $files = Get-ChildItem -Path $folderPath -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $imageExtensions -contains $_.Extension.ToLower() }
    return ($files.Count -gt 0)
}

# ======= QUET THU MUC =======
$skuFolders = Get-ChildItem -Path $rootPath -Directory
$total   = $skuFolders.Count
$current = 0

$results    = [System.Collections.Generic.List[PSCustomObject]]::new()
$skuSummary = @{}

Write-Host "Tim thay $total ma SKU. Dang quet..." -ForegroundColor Yellow
Write-Host ""

foreach ($sku in $skuFolders) {
    $current++
    $skuName = $sku.Name
    $skuPath = $sku.FullName

    $percent = [math]::Round(($current / $total) * 100)
    Write-Progress -Activity "Dang kiem tra..." -Status "SKU: $skuName ($current/$total)" -PercentComplete $percent

    $hasIssue = $false

    foreach ($subName in $subFolderNames) {
        $subPath = Join-Path $skuPath $subName

        if (-not (Test-Path $subPath)) {
            $results.Add([PSCustomObject]@{
                "Ma_SKU"     = $skuName
                "Thu_muc"    = $subName
                "Trang_thai" = "CHUA TAO FOLDER"
                "Duong_dan"  = $subPath
            })
            $hasIssue = $true
        }
        elseif (-not (Has-ImageFiles $subPath)) {
            $results.Add([PSCustomObject]@{
                "Ma_SKU"     = $skuName
                "Thu_muc"    = $subName
                "Trang_thai" = "KHONG CO ANH"
                "Duong_dan"  = $subPath
            })
            $hasIssue = $true
        }
    }

    $skuSummary[$skuName] = if ($hasIssue) { "CO LOI" } else { "OK" }
}

Write-Progress -Activity "Dang kiem tra..." -Completed

$totalOK     = ($skuSummary.Values | Where-Object { $_ -eq "OK" }).Count
$totalError  = ($skuSummary.Values | Where-Object { $_ -eq "CO LOI" }).Count
$totalIssues = $results.Count

Write-Host "Ket qua: $totalOK SKU OK | $totalError SKU co loi | $totalIssues dong loi tong cong" -ForegroundColor Cyan
Write-Host "Dang tao file Excel..." -ForegroundColor Yellow

# ======= TAO EXCEL BANG COM OBJECT =======
$excelPath = Join-Path $rootPath "BAO_CAO_THIEU_ANH_$(Get-Date -Format 'yyyyMMdd_HHmm').xlsx"

$excel = New-Object -ComObject Excel.Application
$excel.Visible        = $false
$excel.DisplayAlerts  = $false

$workbook = $excel.Workbooks.Add()

# -----------------------------------------------
# SHEET 1: CHI TIET LOI
# -----------------------------------------------
$sheet1 = $workbook.Worksheets.Item(1)
$sheet1.Name = "Chi Tiet Loi"

# Tieu de
$sheet1.Cells.Item(1,1).Value2           = "BAO CAO KIEM TRA FOLDER THIEU ANH"
$sheet1.Cells.Item(1,1).Font.Bold        = $true
$sheet1.Cells.Item(1,1).Font.Size        = 16
$sheet1.Cells.Item(1,1).Font.Color       = $clrTitleBlue
$sheet1.Range("A1:D1").Merge()

$sheet1.Cells.Item(2,1).Value2           = "Ngay quet: $(Get-Date -Format 'dd/MM/yyyy HH:mm')"
$sheet1.Cells.Item(2,1).Font.Italic      = $true
$sheet1.Cells.Item(2,1).Font.Color       = $clrGray
$sheet1.Range("A2:D2").Merge()

$sheet1.Cells.Item(3,1).Value2           = "Thu muc goc: $rootPath"
$sheet1.Cells.Item(3,1).Font.Italic      = $true
$sheet1.Range("A3:D3").Merge()

$sheet1.Rows.Item(4).RowHeight = 6

# Header
$s1Headers = @("Ma SKU", "Thu Muc Con", "Trang Thai", "Duong Dan Day Du")
$headerRow = 5
for ($col = 1; $col -le 4; $col++) {
    $c = $sheet1.Cells.Item($headerRow, $col)
    $c.Value2              = $s1Headers[$col-1]
    $c.Font.Bold           = $true
    $c.Font.Color          = $clrHeaderFg
    $c.Interior.Color      = $clrHeaderBg
    $c.HorizontalAlignment = -4108
}

# Du lieu
$rowIdx  = $headerRow + 1
$prevSku = ""
$shade   = $false

foreach ($item in $results) {
    if ($item.Ma_SKU -ne $prevSku -and $prevSku -ne "") { $shade = -not $shade }
    $prevSku = $item.Ma_SKU

    $bgRow = if ($shade) { $clrAlt } else { $clrWhite }

    $sheet1.Cells.Item($rowIdx, 1).Value2          = $item.Ma_SKU
    $sheet1.Cells.Item($rowIdx, 2).Value2          = $item.Thu_muc
    $sheet1.Cells.Item($rowIdx, 3).Value2          = $item.Trang_thai
    $sheet1.Cells.Item($rowIdx, 4).Value2          = $item.Duong_dan

    for ($col = 1; $col -le 4; $col++) {
        $sheet1.Cells.Item($rowIdx, $col).Interior.Color = $bgRow
    }

    # To mau cot trang thai
    $sc = $sheet1.Cells.Item($rowIdx, 3)
    if ($item.Trang_thai -eq "CHUA TAO FOLDER") {
        $sc.Font.Color      = $clrOrangeFg
        $sc.Font.Bold       = $true
        $sc.Interior.Color  = $clrOrangeBg
    } elseif ($item.Trang_thai -eq "KHONG CO ANH") {
        $sc.Font.Color      = $clrRedFg
        $sc.Font.Bold       = $true
        $sc.Interior.Color  = $clrRedBg
    }

    $sheet1.Range("A${rowIdx}:D${rowIdx}").Borders.LineStyle = 1
    $sheet1.Range("A${rowIdx}:D${rowIdx}").Borders.Color     = $clrBorder
    $rowIdx++
}

# Vien header
$sheet1.Range("A${headerRow}:D${headerRow}").Borders.LineStyle = 1
$sheet1.Range("A${headerRow}:D${headerRow}").Borders.Color     = $clrHeaderBg

# Do rong cot
$sheet1.Columns.Item(1).ColumnWidth = 20
$sheet1.Columns.Item(2).ColumnWidth = 22
$sheet1.Columns.Item(3).ColumnWidth = 22
$sheet1.Columns.Item(4).ColumnWidth = 65

# Freeze
$sheet1.Activate()
$sheet1.Application.ActiveWindow.SplitRow    = $headerRow
$sheet1.Application.ActiveWindow.FreezePanes = $true

# -----------------------------------------------
# SHEET 2: TONG HOP THEO SKU
# -----------------------------------------------
$sheet2 = $workbook.Worksheets.Add()
$sheet2.Name = "Tong Hop SKU"
$workbook.Worksheets.Item("Tong Hop SKU").Move($workbook.Worksheets.Item(1))

# Tieu de
$sheet2.Cells.Item(1,1).Value2      = "TONG HOP TRANG THAI THEO MA SKU"
$sheet2.Cells.Item(1,1).Font.Bold   = $true
$sheet2.Cells.Item(1,1).Font.Size   = 14
$sheet2.Cells.Item(1,1).Font.Color  = $clrTitleBlue
$sheet2.Range("A1:G1").Merge()

$sheet2.Cells.Item(2,1).Value2      = "Tong SKU: $total  |  Hoan chinh: $totalOK  |  Co loi: $totalError  |  Tong so dong loi: $totalIssues"
$sheet2.Cells.Item(2,1).Font.Italic = $true
$sheet2.Range("A2:G2").Merge()

$sheet2.Rows.Item(3).RowHeight = 6

# Header
$h2Headers = @("Ma SKU", "0_Anh_AVT", "1_Anh_Hang", "2_Anh_Tu_Chup", "3_Video_Doc", "4_Video_Ngang", "Ket Qua")
$h2Row = 4
for ($col = 1; $col -le 7; $col++) {
    $c = $sheet2.Cells.Item($h2Row, $col)
    $c.Value2              = $h2Headers[$col-1]
    $c.Font.Bold           = $true
    $c.Font.Color          = $clrHeaderFg
    $c.Interior.Color      = $clrHeaderBg
    $c.HorizontalAlignment = -4108
}

# Map SKU -> sub -> trang thai
$skuMap = @{}
foreach ($item in $results) {
    if (-not $skuMap.ContainsKey($item.Ma_SKU)) { $skuMap[$item.Ma_SKU] = @{} }
    $skuMap[$item.Ma_SKU][$item.Thu_muc] = $item.Trang_thai
}

$colMap = @{
    "0_Anh_AVT"     = 2
    "1_Anh_Hang"    = 3
    "2_Anh_Tu_Chup" = 4
    "3_Video_Doc"   = 5
    "4_Video_Ngang" = 6
}

$r2     = $h2Row + 1
$altRow = $false
$allSKUs = $skuFolders | Select-Object -ExpandProperty Name | Sort-Object

foreach ($skuName in $allSKUs) {
    $altRow = -not $altRow
    $bgBase = if ($altRow) { $clrAlt } else { $clrWhite }

    $sheet2.Cells.Item($r2, 1).Value2          = $skuName
    $sheet2.Cells.Item($r2, 1).Interior.Color  = $bgBase

    $hasAnyError = $false

    foreach ($sub in $subFolderNames) {
        $colIdx = $colMap[$sub]
        $c      = $sheet2.Cells.Item($r2, $colIdx)
        $c.HorizontalAlignment = -4108

        if ($skuMap.ContainsKey($skuName) -and $skuMap[$skuName].ContainsKey($sub)) {
            $st = $skuMap[$skuName][$sub]
            $hasAnyError = $true
            if ($st -eq "CHUA TAO FOLDER") {
                $c.Value2          = "CHUA TAO"
                $c.Interior.Color  = $clrOrangeBg
                $c.Font.Color      = $clrOrangeFg
                $c.Font.Bold       = $true
            } else {
                $c.Value2          = "KHONG CO ANH"
                $c.Interior.Color  = $clrRedBg
                $c.Font.Color      = $clrRedFg
                $c.Font.Bold       = $true
            }
        } else {
            $c.Value2          = "OK"
            $c.Interior.Color  = $clrOkBg
            $c.Font.Color      = $clrOkFg
        }
    }

    # Cot ket qua
    $kq = $sheet2.Cells.Item($r2, 7)
    $kq.HorizontalAlignment = -4108
    if ($hasAnyError) {
        $kq.Value2         = "CO LOI"
        $kq.Interior.Color = $clrRedBg
        $kq.Font.Color     = $clrRedFg
        $kq.Font.Bold      = $true
    } else {
        $kq.Value2         = "HOAN CHINH"
        $kq.Interior.Color = $clrOkBg
        $kq.Font.Color     = $clrOkFg
        $kq.Font.Bold      = $true
    }

    $sheet2.Range("A${r2}:G${r2}").Borders.LineStyle = 1
    $sheet2.Range("A${r2}:G${r2}").Borders.Color     = $clrBorder
    $r2++
}

# Vien header sheet2
$sheet2.Range("A${h2Row}:G${h2Row}").Borders.LineStyle = 1
$sheet2.Range("A${h2Row}:G${h2Row}").Borders.Color     = $clrHeaderBg

# Do rong cot sheet2
$sheet2.Columns.Item(1).ColumnWidth = 22
for ($c2 = 2; $c2 -le 6; $c2++) { $sheet2.Columns.Item($c2).ColumnWidth = 16 }
$sheet2.Columns.Item(7).ColumnWidth = 14

# Freeze
$sheet2.Activate()
$sheet2.Application.ActiveWindow.SplitRow    = $h2Row
$sheet2.Application.ActiveWindow.FreezePanes = $true

# -----------------------------------------------
# Luu va dong
# -----------------------------------------------
$workbook.SaveAs($excelPath)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DA XUAT FILE EXCEL THANH CONG!" -ForegroundColor Green
Write-Host "  $excelPath" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Tong SKU    : $total"       -ForegroundColor White
Write-Host "  Hoan chinh  : $totalOK"     -ForegroundColor Green
Write-Host "  Co loi      : $totalError"  -ForegroundColor Red
Write-Host "  Tong so loi : $totalIssues dong" -ForegroundColor Yellow
Write-Host ""

Start-Process $excelPath
pause
