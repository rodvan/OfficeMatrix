# Preparación S1F. No se invoca desde la app. Por defecto solo devuelve el plan.
[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='High')]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9][a-z0-9-]{2,39}$')][string]$Id,
  [Parameter(Mandatory=$true)][string]$Raiz,
  [Security.SecureString]$Password,
  [switch]$Aplicar
)
$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path -LiteralPath $Raiz).Path
if ($Id -eq 'edificio' -or (Split-Path $resolved -Leaf) -ne $Id -or !(Test-Path -LiteralPath (Join-Path $resolved 'oficina.json'))) { throw 'RAIZ_INVALIDA' }
if ((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_POINT' }
$sha = [Security.Cryptography.SHA256]::Create()
try { $hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Id)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
$name = 'om-' + $Id.Substring(0,[Math]::Min(12,$Id.Length)) + $hash.Substring(0,4)
$writable = @('proyectos','memoria','cola','bandeja\salida','entregas','informes','actas')
# Plan completo del instalador. -Aplicar sigue creando solo la cuenta y las ACL de la carpeta:
# no copia binarios, no cifra con DPAPI y no se ejecuta desde la app.
$programData = Join-Path $env:ProgramData "OfficeMatrix\$Id"
if (!$Aplicar) {
  @{
    id=$Id; cuenta=$name; grupo='OfficeMatrix-Sims'; raiz=$resolved
    programData=$programData
    binarios=@(
      @{ nombre='node'; destino=(Join-Path $programData 'node.exe'); verificar='hash antes de lanzar' }
      @{ nombre='worker'; destino=(Join-Path $programData 'worker.js'); verificar='hash antes de lanzar' }
    )
    token=@{ destino=(Join-Path $programData 'worker.token'); acl='solo la cuenta de la oficina'; argv=$false }
    dpapi=@{ alcance='CurrentUser de la cuenta de la oficina'; no='el usuario del servidor' }
    clis=@('claude','codex','grok','agy')
    lectura='RX'; escritura=$writable; estado='plan-sin-ejecutar'
    nota='No provisiona ProgramData ni la frontera. El usuario lo aplicara cuando decida.'
  } | ConvertTo-Json -Depth 5
  return
}
if (!$Password) { throw 'PASSWORD_REQUERIDA: suministrar SecureString; no poner secretos en argv' }
if (!$PSCmdlet.ShouldProcess($name, 'Crear cuenta y permisos de oficina (no habilita frontera)')) { return }
if (Get-LocalUser -Name $name -ErrorAction SilentlyContinue) { throw 'CUENTA_YA_EXISTE' }
function Grant-Checked([string]$Target, [string[]]$Rules) {
  & icacls.exe $Target /grant:r @Rules | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "ACL_FALLO: $Target" }
}
$user = $null
try {
  $user = New-LocalUser -Name $name -Password $Password -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires -Description "OfficeMatrix:$Id"
  # Users por SID: funciona con Windows en español; nunca Administradores.
  Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $user
  $sid = '*' + $user.SID.Value
  Grant-Checked $resolved @("${sid}:(OI)(CI)RX")
  foreach ($rel in $writable) {
    $target = Join-Path $resolved $rel
    $ancestor = $target
    while ($ancestor -and $ancestor -ne $resolved) {
      if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'REPARSE_POINT' }
      $ancestor = Split-Path $ancestor -Parent
    }
    if (!(Test-Path -LiteralPath $target)) { New-Item -ItemType Directory -Path $target | Out-Null }
    if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_POINT' }
    Grant-Checked $target @("${sid}:(WD,AD)", "${sid}:(OI)(CI)(IO)M")
  }
  @{ id=$Id; cuenta=$name; estado='cuenta-creada-frontera-NO-verificada' } | ConvertTo-Json
} catch {
  # Si el ACL falla a medias, una cuenta deshabilitada dejaría el siguiente intento en CUENTA_YA_EXISTE.
  if ($user) {
    Disable-LocalUser -Name $name -ErrorAction SilentlyContinue
    Remove-LocalUser -Name $name -ErrorAction SilentlyContinue
  }
  throw
}
