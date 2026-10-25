# No borra datos ni perfiles. Por defecto solo muestra el plan.
[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='High')]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9][a-z0-9-]{2,39}$')][string]$Id,
  [Parameter(Mandatory=$true)][ValidatePattern('^om-[a-z0-9-]{3,16}$')][string]$Cuenta,
  [switch]$Aplicar
)
$ErrorActionPreference = 'Stop'
if (!$Aplicar) { @{id=$Id; cuenta=$Cuenta; accion='quitar-cuenta-conservar-datos'; estado='plan-sin-ejecutar'} | ConvertTo-Json; return }
$user = Get-LocalUser -Name $Cuenta
if ($user.Description -ne "OfficeMatrix:$Id") { throw 'CUENTA_AJENA' }
if ($PSCmdlet.ShouldProcess($Cuenta, 'Eliminar cuenta local de OfficeMatrix; conservar todos los datos')) {
  Disable-LocalUser -Name $Cuenta
  Remove-LocalUser -Name $Cuenta
}
