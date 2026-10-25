# The quiz Wi-Fi on Windows 10/11: Windows' own Mobile Hotspot, driven through its WinRT tethering API
# (Windows.Networking.NetworkOperators). Used by laptop.js; prints one line of JSON for each action.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File hotspot-windows.ps1 status
#   powershell -NoProfile -ExecutionPolicy Bypass -File hotspot-windows.ps1 up <base64 JSON {"ssid":..,"password":..}>
#   powershell -NoProfile -ExecutionPolicy Bypass -File hotspot-windows.ps1 down
#
# What Windows allows, unlike Linux:
# - Mobile Hotspot always has a WPA2 password (8-63 characters); there is no open network, so phones cannot be sent to
#   the quiz by a sign-in window. The TV shows a Wi-Fi QR code with the password, then the quiz address.
# - It shares one of the laptop's connections. Windows refuses to start it when the laptop has no network connection
#   at all, so a laptop with no other network needs a network cable, a phone's hotspot or a second Wi-Fi adapter.
# - Phones get addresses on 192.168.137.x and reach the laptop at 192.168.137.1.
# - No administrator rights are needed. Nothing else on the network is changed, and "down" turns it off again.
# The settings come in as base64 JSON so that a Wi-Fi name starting with "-" is never read as a PowerShell option.
param([Parameter(Mandatory = $true)][ValidateSet('status', 'up', 'down')][string]$Action, [string]$Config = '')
$ErrorActionPreference = 'Stop'

function Out-Json($value) { $value | ConvertTo-Json -Compress -Depth 5; }

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
  $null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
} catch {
  Out-Json @{available = $false; reason = 'This version of Windows has no Mobile Hotspot API (Windows 10 version 1607 or later is needed).'}
  exit 0
}
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
function Await($operation, [Type]$resultType) {
  $method = ($asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0].MakeGenericMethod($resultType)
  $task = $method.Invoke($null, @($operation)); $null = $task.Wait(60000); $task.Result
}
function AwaitAction($action) {
  $task = ($asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0].Invoke($null, @($action)); $null = $task.Wait(60000)
}

# The connection to share: the internet connection if there is one, otherwise any connected network.
function Get-Manager {
  $info = [Windows.Networking.Connectivity.NetworkInformation]
  $manager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]
  $profiles = @($info::GetInternetConnectionProfile()) + @($info::GetConnectionProfiles() | Where-Object { $_.GetNetworkConnectivityLevel() -ne 'None' }) | Where-Object { $_ }
  foreach ($profile in $profiles) {
    if ($manager::GetTetheringCapabilityFromConnectionProfile($profile) -eq 'Enabled') { return @{manager = $manager::CreateFromConnectionProfile($profile); shares = $profile.ProfileName} }
  }
  $reason = if ($profiles.Count) { "Windows will not share '$($profiles[0].ProfileName)' as a Mobile Hotspot ($($manager::GetTetheringCapabilityFromConnectionProfile($profiles[0])))." } else { 'Windows only starts Mobile Hotspot while the laptop is connected to a network. Connect a network cable, a phone hotspot or a second Wi-Fi adapter, or use the venue Wi-Fi instead.' }
  return @{manager = $null; reason = $reason}
}

$cards = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.NdisPhysicalMedium -eq 9 } | ForEach-Object {
  @{name = $_.Name; ap = $true; connected = $_.Status -eq 'Up'; network = ''; hosting = $false}
})
$found = Get-Manager
$manager = $found.manager

if ($Action -eq 'status') {
  $running = $null
  if ($manager -and $manager.TetheringOperationalState -eq 'On') {
    $config = $manager.GetCurrentAccessPointConfiguration()
    $running = @{interface = 'Mobile Hotspot'; ssid = $config.Ssid; password = $config.Passphrase; address = '192.168.137.1'; clients = $manager.ClientCount; keepWifi = $true}
  }
  $pick = if ($manager) { @{interface = 'Mobile Hotspot'; keepWifi = $true; shares = $found.shares} } else { $null }
  Out-Json @{available = $true; platform = 'windows'; needsPassword = $true; wifiOn = $cards.Count -gt 0; cards = $cards; pick = $pick; running = $running; reason = $found.reason}
  exit 0
}
if (-not $manager) { [Console]::Error.WriteLine($found.reason); exit 1 }

if ($Action -eq 'down') {
  if ($manager.TetheringOperationalState -ne 'Off') {
    $result = Await ($manager.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
    if ($result.Status -ne 'Success') { [Console]::Error.WriteLine("Windows could not stop Mobile Hotspot: $($result.Status) $($result.AdditionalErrorMessage)"); exit 1 }
  }
  Write-Output 'Quiz Wi-Fi stopped.'
  exit 0
}

$settings = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Config)) | ConvertFrom-Json
if ($manager.TetheringOperationalState -ne 'Off') { $null = Await ($manager.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]) }
$config = $manager.GetCurrentAccessPointConfiguration()
$config.Ssid = $settings.ssid
$config.Passphrase = $settings.password
AwaitAction ($manager.ConfigureAccessPointAsync($config))
$result = Await ($manager.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
if ($result.Status -ne 'Success') { [Console]::Error.WriteLine("Windows could not start Mobile Hotspot: $($result.Status) $($result.AdditionalErrorMessage)"); exit 1 }
Write-Output "Quiz Wi-Fi '$($settings.ssid)' is on (Windows Mobile Hotspot, sharing $($found.shares)). Phones open http://192.168.137.1"
