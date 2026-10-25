# Imágenes tipográficas de ejemplo, reproducibles y sin dependencias. No son contenido investigado real.
Add-Type -AssemblyName System.Drawing
$destinoEditorial = Join-Path $PSScriptRoot '../fixtures/editorial'
New-Item -ItemType Directory -Force -Path $destinoEditorial | Out-Null
$hooksEditorial = @('Tu cerebro también|necesita una pausa', 'Dormir es parte|del trabajo', 'Menos ruido.|Más ideas.')
$coloresEditorial = @('#57DCC6', '#F2B86E', '#B99AF7')
for ($iEditorial = 0; $iEditorial -lt 3; $iEditorial++) {
  $bitmapEditorial = [System.Drawing.Bitmap]::new(960, 540)
  $graficoEditorial = [System.Drawing.Graphics]::FromImage($bitmapEditorial)
  $graficoEditorial.SmoothingMode = 'AntiAlias'
  $graficoEditorial.TextRenderingHint = 'AntiAliasGridFit'
  $graficoEditorial.Clear([System.Drawing.ColorTranslator]::FromHtml('#142327'))
  $acentoEditorial = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($coloresEditorial[$iEditorial]))
  $blancoEditorial = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#F3F4EB'))
  $fontEditorial = [System.Drawing.Font]::new('Arial', 47, [System.Drawing.FontStyle]::Bold)
  $smallEditorial = [System.Drawing.Font]::new('Arial', 15)
  $graficoEditorial.FillEllipse($acentoEditorial, 735, -75, 330, 330)
  $graficoEditorial.DrawString('FARO CURIOSO  /  CIENCIA COTIDIANA', $smallEditorial, $acentoEditorial, 55, 48)
  $lineasEditorial = $hooksEditorial[$iEditorial].Split('|')
  for ($jEditorial = 0; $jEditorial -lt $lineasEditorial.Length; $jEditorial++) {
    $graficoEditorial.DrawString($lineasEditorial[$jEditorial], $fontEditorial, $blancoEditorial, 50, (205 + 80 * $jEditorial))
  }
  $graficoEditorial.DrawString('IDEA DE EJEMPLO  /  DEMO EDITORIAL', $smallEditorial, $acentoEditorial, 55, 465)
  $bitmapEditorial.Save((Join-Path $destinoEditorial "imagen-$($iEditorial + 1).png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $graficoEditorial.Dispose(); $bitmapEditorial.Dispose(); $fontEditorial.Dispose(); $smallEditorial.Dispose(); $acentoEditorial.Dispose(); $blancoEditorial.Dispose()
}
