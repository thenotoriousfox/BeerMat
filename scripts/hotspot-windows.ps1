# The quiz Wi-Fi on Windows 10/11: Windows' own Mobile Hotspot, driven through its WinRT tethering API
# (Windows.Networking.NetworkOperators), kept off the internet with Windows Filtering Platform filters. Used by
# laptop.js; prints one line of JSON for status, a message otherwise.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File hotspot-windows.ps1 status [-StateDir <folder>]
#   powershell -NoProfile -ExecutionPolicy Bypass -File hotspot-windows.ps1 up <base64 JSON {"ssid":..,"password":..}> [-StateDir <folder>] [-OwnerPid <pid>]
#   powershell -NoProfile -ExecutionPolicy Bypass -File hotspot-windows.ps1 down [-StateDir <folder>]
#   (serve: what "up" starts, as administrator; not run by hand)
#
# What Windows allows, unlike Linux:
# - Mobile Hotspot always has a WPA2 password (8-63 characters); there is no open network, so phones cannot be sent to
#   the quiz by a sign-in window. The TV shows a Wi-Fi QR code with the password, then the quiz address.
# - It shares one of the laptop's connections (Internet Connection Sharing: NAT, a DHCP server and a DNS proxy).
#   Windows refuses to start it when the laptop has no network connection at all, and neither the tethering API nor
#   ICS has a "local only" setting, so sharing cannot simply be switched off.
# - Phones get addresses from ICS, normally 192.168.137.x with the laptop at 192.168.137.1 (the ScopeAddress setting
#   can move it); the address is read from the hotspot's own adapter, never assumed.
#
# Keeping players off the internet. Ordinary Windows Firewall rules only see traffic to and from the laptop itself,
# not traffic ICS forwards for phones, so they cannot do this. Instead "serve" runs as administrator (one UAC prompt
# per start), starts the hotspot itself and, as soon as its adapter is up, adds Windows Filtering Platform filters in a
# dynamic WFP session that block, on that adapter only:
#   - forwarding, IPv4 and IPv6, in both directions (the IP forward layers);
#   - any packet arriving from a phone that is not for the laptop's hotspot address, broadcast or multicast (IPv6:
#     link-local and multicast), which also covers the laptop's other addresses (the inbound IP packet layers);
#   - DNS (port 53) to the laptop, so ICS's DNS proxy cannot look names up on the internet for phones. Phones join by
#     address, so the quiz never needs DNS.
# DHCP, the quiz server, and the laptop's own traffic on its other connections are untouched. Dynamic WFP objects are
# deleted by Windows when the session's process ends for any reason (stopped, crashed, killed, logged off), so nothing
# outlives BeerMat and nothing is stored. "serve" checks every few seconds that its filters are still there; it stops
# the hotspot if they or the adapter go away, if Windows switches the hotspot off, if BeerMat (the owner process)
# quits, or when "down" asks. If the filters cannot be added the hotspot is stopped again: there is no fallback to a
# hotspot that shares the internet.
#
# The settings come in as base64 JSON so that a Wi-Fi name starting with "-" is never read as a PowerShell option.
param([Parameter(Mandatory = $true)][ValidateSet('status', 'up', 'down', 'serve')][string]$Action, [string]$ConfigBase64 = '',
  [string]$StateDir = '', [int]$OwnerPid = 0, [string]$Nonce = '')
$ErrorActionPreference = 'Stop'

function Out-Json($value) { $value | ConvertTo-Json -Compress -Depth 5; }
function Now-Ms { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
# The folder BeerMat and the administrator helper share: state.json (written by the helper) and a "stop" request.
# laptop.js passes it in; "up" passes it on, so a helper running under another administrator account still finds it.
if (-not $StateDir) { $StateDir = Join-Path $env:LOCALAPPDATA 'BeerMat\hotspot' }
$StatePath = Join-Path $StateDir 'state.json'
$StopPath = Join-Path $StateDir 'stop'

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
  $null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
} catch {
  if ($Action -eq 'status') { Out-Json @{available = $false; reason = 'This version of Windows has no Mobile Hotspot API (Windows 10 version 1607 or later is needed).'}; exit 0 }
  [Console]::Error.WriteLine('This version of Windows has no Mobile Hotspot API (Windows 10 version 1607 or later is needed).'); exit 1
}
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
function Await($operation, [Type]$resultType) {
  $method = ($asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0].MakeGenericMethod($resultType)
  $task = $method.Invoke($null, @($operation)); $null = $task.Wait(60000); $task.Result
}
function AwaitAction($action) {
  $task = ($asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0].Invoke($null, @($action)); $null = $task.Wait(60000)
}
$ResultType = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]

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
function Stop-Hotspot($manager) {
  if ($manager -and $manager.TetheringOperationalState -ne 'Off') {
    $result = Await ($manager.StopTetheringAsync()) $ResultType
    if ($result.Status -ne 'Success') { throw "Windows could not stop Mobile Hotspot: $($result.Status) $($result.AdditionalErrorMessage)" }
  }
}

# The hotspot's own adapter and the address ICS gave it: the Wi-Fi Direct virtual adapter Mobile Hotspot creates,
# holding ICS's scope address (192.168.137.1 unless ScopeAddress says otherwise). $null while it is not up.
function Get-HotspotInterface {
  $scope = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters' -ErrorAction SilentlyContinue).ScopeAddress
  if (-not $scope) { $scope = '192.168.137.1' }
  $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' })
  $virtual = @(Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -like '*Wi-Fi Direct Virtual Adapter*' } | ForEach-Object { $_.ifIndex })
  $ip = @($ips | Where-Object { $virtual -contains $_.InterfaceIndex -and $_.IPAddress -eq $scope }) + @($ips | Where-Object { $_.IPAddress -eq $scope }) +
    @($ips | Where-Object { $virtual -contains $_.InterfaceIndex }) | Select-Object -First 1
  if (-not $ip) { return $null }
  return @{index = [int]$ip.InterfaceIndex; alias = $ip.InterfaceAlias; address = $ip.IPAddress; prefixLength = [int]$ip.PrefixLength}
}

function Read-State { try { Get-Content -Raw -LiteralPath $StatePath -ErrorAction Stop | ConvertFrom-Json } catch { $null } }
function Write-State($state) {
  $null = New-Item -ItemType Directory -Force -Path $StateDir
  $temp = "$StatePath.$PID.tmp"
  Out-Json $state | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -Force -LiteralPath $temp -Destination $StatePath
}
function Process-Alive([int]$id) { $id -gt 0 -and [bool](Get-Process -Id $id -ErrorAction SilentlyContinue) }

# What status reports about isolation. "configured" only when the helper is alive, has checked its filters in the
# last 20 seconds and they are on the adapter the hotspot is using now; whether phones are really kept off the internet
# is for the phones to show (BeerMat asks players' browsers to try, server.js).
function Get-Isolation($running) {
  $state = Read-State
  $outside = if ($running) { 'Mobile Hotspot was started outside BeerMat, so nothing keeps phones off the internet. Stop it and start the quiz Wi-Fi from BeerMat.' } else { '' }
  if (-not $state -or ($state.state -in @('stopped', 'starting') -and -not (Process-Alive $state.pid))) { return @{configured = $false; state = 'off'; reason = $outside} }
  $alive = Process-Alive $state.pid
  $fresh = $state.checkedAt -and ((Now-Ms) - [int64]$state.checkedAt) -lt 20000
  $same = $running -and $state.interfaceIndex -eq $running.interfaceIndex
  $configured = $state.state -eq 'applied' -and $alive -and $fresh -and $same -and $state.present -eq $state.filters -and $state.filters -gt 0
  $reason = if ($configured) { '' } elseif ($state.state -eq 'applied' -and -not $alive) { 'The BeerMat isolation helper is no longer running, so phones may reach the internet. Stop and start the quiz Wi-Fi.' }
    elseif ($state.state -eq 'applied' -and -not $same) { 'Mobile Hotspot is on a different adapter from the one BeerMat isolated. Stop and start the quiz Wi-Fi.' }
    elseif ($state.state -eq 'applied' -and $state.present -ne $state.filters) { "Windows no longer has all of BeerMat's isolation filters ($($state.present) of $($state.filters)). Stop and start the quiz Wi-Fi." }
    elseif ($state.state -eq 'applied') { 'The BeerMat isolation helper has stopped checking its filters. Stop and start the quiz Wi-Fi.' }
    elseif ($state.state -eq 'starting') { 'BeerMat is still putting its isolation filters on.' }
    else { [string]$state.reason }
  return @{configured = [bool]$configured; state = [string]$state.state; reason = $reason; filters = [int]$state.filters; present = [int]$state.present;
    interfaceIndex = $state.interfaceIndex; checkedAt = $state.checkedAt; layers = $state.layers}
}

if ($Action -eq 'status') {
  $cards = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.NdisPhysicalMedium -eq 9 } | ForEach-Object {
    @{name = $_.Name; ap = $true; connected = $_.Status -eq 'Up'; network = ''; hosting = $false}
  })
  $found = Get-Manager
  $manager = $found.manager
  $running = $null
  $hotspot = Get-HotspotInterface
  if ($manager -and $manager.TetheringOperationalState -eq 'On') {
    $apConfig = $manager.GetCurrentAccessPointConfiguration()
    $running = @{interface = 'Mobile Hotspot'; ssid = $apConfig.Ssid; password = $apConfig.Passphrase; clients = $manager.ClientCount; keepWifi = $true;
      address = if ($hotspot) { $hotspot.address } else { $null }; interfaceIndex = if ($hotspot) { $hotspot.index } else { $null }; adapter = if ($hotspot) { $hotspot.alias } else { $null }}
    $running.isolation = Get-Isolation $running
  }
  $scope = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters' -ErrorAction SilentlyContinue).ScopeAddress
  $pick = if ($manager) { @{interface = 'Mobile Hotspot'; keepWifi = $true; shares = $found.shares} } else { $null }
  Out-Json @{available = $true; platform = 'windows'; needsPassword = $true; wifiOn = $cards.Count -gt 0; cards = $cards; pick = $pick; running = $running; reason = $found.reason;
    address = if ($running -and $running.address) { $running.address } elseif ($scope) { $scope } else { '192.168.137.1' }; isolates = $true}
  exit 0
}

if ($Action -eq 'down') {
  # Ask the helper to stop (it switches the hotspot off, then its filters go with it), then make sure.
  $state = Read-State
  if ($state -and (Process-Alive $state.pid)) {
    $null = New-Item -ItemType Directory -Force -Path $StateDir
    Set-Content -LiteralPath $StopPath -Value 'stop'
    $deadline = (Get-Date).AddSeconds(30)
    while ((Process-Alive $state.pid) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  }
  $found = Get-Manager
  try { Stop-Hotspot $found.manager } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
  Remove-Item -LiteralPath $StopPath -ErrorAction SilentlyContinue
  Write-Output 'Quiz Wi-Fi stopped.'
  exit 0
}

if ($Action -eq 'up') {
  try { $null = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ConfigBase64)) | ConvertFrom-Json } catch { [Console]::Error.WriteLine('Invalid Wi-Fi settings.'); exit 1 }
  $found = Get-Manager
  if (-not $found.manager) { [Console]::Error.WriteLine($found.reason); exit 1 }
  # A helper from an earlier start stops first, so there is only ever one.
  $old = Read-State
  if ($old -and (Process-Alive $old.pid)) {
    $null = New-Item -ItemType Directory -Force -Path $StateDir
    Set-Content -LiteralPath $StopPath -Value 'stop'
    $deadline = (Get-Date).AddSeconds(30)
    while ((Process-Alive $old.pid) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  }
  Remove-Item -LiteralPath $StopPath -ErrorAction SilentlyContinue
  $nonce = [guid]::NewGuid().ToString('N')
  $quote = { param($s) '"' + ($s -replace '"', '') + '"' }
  $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', (& $quote $PSCommandPath), 'serve',
    $ConfigBase64, '-StateDir', (& $quote $StateDir), '-OwnerPid', $OwnerPid, '-Nonce', $nonce)
  try { $helper = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru }
  catch { [Console]::Error.WriteLine('The quiz Wi-Fi needs administrator approval to keep players off the internet, and it was not given, so the quiz Wi-Fi was not started.'); exit 1 }
  # The helper writes its progress to state.json; it starts the hotspot itself once its filters are ready to go on.
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300
    $state = Read-State
    if ($state -and $state.nonce -eq $nonce -and $state.state -eq 'applied') {
      Write-Output "Quiz Wi-Fi '$($state.ssid)' is on (Windows Mobile Hotspot, with $($state.filters) internet isolation filters on its adapter; the first phones to join check them). Phones open http://$($state.address)"
      exit 0
    }
    if ($state -and $state.nonce -eq $nonce -and $state.state -in @('failed', 'stopped', 'lost')) { [Console]::Error.WriteLine($state.reason); exit 1 }
    $gone = try { $helper.HasExited } catch { $false }
    if ($gone -and -not ($state -and $state.nonce -eq $nonce)) { break }
  }
  # No answer: make sure nothing is left on.
  Set-Content -LiteralPath $StopPath -Value 'stop' -ErrorAction SilentlyContinue
  try { Stop-Hotspot $found.manager } catch {}
  [Console]::Error.WriteLine('The BeerMat isolation helper did not start, so the quiz Wi-Fi was not started.')
  exit 1
}

# serve: as administrator. Starts the hotspot, keeps its filters on, and switches the hotspot off when it ends.
$wfp = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// Windows Filtering Platform filters, in a dynamic session: Windows removes them when this process ends.
public sealed class BeerMatIsolation : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct DisplayData { public IntPtr name; public IntPtr description; }
  [StructLayout(LayoutKind.Sequential)] struct Blob { public uint size; public IntPtr data; }
  [StructLayout(LayoutKind.Sequential)] struct Session { public Guid key; public DisplayData display; public uint flags; public uint txnWaitTimeout; public uint processId; public IntPtr sid; public IntPtr username; public int kernelMode; }
  [StructLayout(LayoutKind.Sequential)] struct SubLayer { public Guid key; public DisplayData display; public uint flags; public IntPtr providerKey; public Blob providerData; public ushort weight; }
  [StructLayout(LayoutKind.Sequential)] struct Value { public uint type; public IntPtr value; }
  [StructLayout(LayoutKind.Sequential)] struct Condition { public Guid field; public uint match; public Value value; }
  [StructLayout(LayoutKind.Sequential)] struct Action { public uint type; public Guid filterType; }
  [StructLayout(LayoutKind.Sequential)] struct Filter {
    public Guid key; public DisplayData display; public uint flags; public IntPtr providerKey; public Blob providerData; public Guid layer; public Guid subLayer;
    public Value weight; public uint numConditions; public IntPtr conditions; public Action action; public ulong context0; public ulong context1;
    public IntPtr reserved; public ulong id; public Value effectiveWeight; }

  [DllImport("fwpuclnt.dll", CharSet = CharSet.Unicode)] static extern uint FwpmEngineOpen0(string server, uint authn, IntPtr identity, ref Session session, out IntPtr engine);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmEngineClose0(IntPtr engine);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmTransactionBegin0(IntPtr engine, uint flags);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmTransactionCommit0(IntPtr engine);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmTransactionAbort0(IntPtr engine);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmSubLayerAdd0(IntPtr engine, ref SubLayer subLayer, IntPtr sd);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterAdd0(IntPtr engine, ref Filter filter, IntPtr sd, out ulong id);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterGetById0(IntPtr engine, ulong id, out IntPtr filter);
  [DllImport("fwpuclnt.dll")] static extern void FwpmFreeMemory0(ref IntPtr p);

  const uint SessionDynamic = 1, AuthnWinNT = 10, Uint8 = 1, Uint16 = 2, Uint32 = 3, V4Mask = 0x100, V6Mask = 0x101, MatchEqual = 0;
  const uint Block = 0x1001, Permit = 0x1002;
  static readonly Guid InboundV4 = new Guid("c86fd1bf-21cd-497e-a0bb-17425c885c58"), InboundV6 = new Guid("f52032cb-991c-46e7-971d-2601459a91ca");
  static readonly Guid ForwardV4 = new Guid("a82acc24-4ee1-4ee1-b465-fd1d25cb10a4"), ForwardV6 = new Guid("7b964818-19c7-493a-b71f-832c3684d28c");
  static readonly Guid AcceptV4 = new Guid("e1cd9fe7-f4b5-4273-96c0-592e487b8650"), AcceptV6 = new Guid("a3b42c97-9f04-4672-b87e-cee9c483257f");
  static readonly Guid LocalAddress = new Guid("d9ee00de-c1ef-4617-bfe3-ffd8f5a08957"), LocalPort = new Guid("0c1ba1af-5765-453f-af22-a8f791ac775b");
  static readonly Guid InterfaceIndex = new Guid("667fd755-d695-434a-8af5-d3835a1259bc");
  static readonly Guid SourceInterface = new Guid("2311334d-c92d-45bf-9496-edf447820e2d"), DestinationInterface = new Guid("35cf6522-4139-45ee-a0d5-67b80949d879");

  IntPtr engine;
  readonly List<IntPtr> memory = new List<IntPtr>();
  readonly List<ulong> ids = new List<ulong>();
  public readonly List<string> Names = new List<string>();
  Guid subLayer = Guid.NewGuid();

  static void Check(uint rc, string what) { if (rc != 0) throw new Exception(string.Format("{0} failed (0x{1:X8})", what, rc)); }
  IntPtr Text(string s) { IntPtr p = Marshal.StringToHGlobalUni(s); memory.Add(p); return p; }
  IntPtr Bytes(byte[] b) { IntPtr p = Marshal.AllocHGlobal(b.Length); Marshal.Copy(b, 0, p, b.Length); memory.Add(p); return p; }
  static Condition Number(Guid field, uint type, uint n) { Condition c = new Condition(); c.field = field; c.match = MatchEqual; c.value.type = type; c.value.value = new IntPtr(n); return c; }
  // IPv4 addresses are in host byte order for WFP.
  static uint V4(byte[] a) { return ((uint)a[0] << 24) | ((uint)a[1] << 16) | ((uint)a[2] << 8) | a[3]; }
  Condition Subnet4(uint address, uint mask) {
    byte[] b = new byte[8]; BitConverter.GetBytes(address).CopyTo(b, 0); BitConverter.GetBytes(mask).CopyTo(b, 4);
    Condition c = new Condition(); c.field = LocalAddress; c.match = MatchEqual; c.value.type = V4Mask; c.value.value = Bytes(b); return c;
  }
  Condition Subnet6(string prefix, byte length) {
    byte[] b = new byte[17]; System.Net.IPAddress.Parse(prefix).GetAddressBytes().CopyTo(b, 0); b[16] = length;
    Condition c = new Condition(); c.field = LocalAddress; c.match = MatchEqual; c.value.type = V6Mask; c.value.value = Bytes(b); return c;
  }

  void Add(Guid layer, string name, uint action, byte weight, params Condition[] conditions) {
    int size = Marshal.SizeOf(typeof(Condition));
    IntPtr list = Marshal.AllocHGlobal(size * conditions.Length); memory.Add(list);
    for (int i = 0; i < conditions.Length; i++) Marshal.StructureToPtr(conditions[i], new IntPtr(list.ToInt64() + i * size), false);
    Filter f = new Filter();
    f.key = Guid.NewGuid(); f.display.name = Text("BeerMat quiz Wi-Fi: " + name); f.layer = layer; f.subLayer = subLayer;
    f.weight.type = Uint8; f.weight.value = new IntPtr(weight); f.numConditions = (uint)conditions.Length; f.conditions = list; f.action.type = action;
    ulong id; Check(FwpmFilterAdd0(engine, ref f, IntPtr.Zero, out id), "Adding the filter '" + name + "'");
    ids.Add(id); Names.Add(name);
  }

  public BeerMatIsolation(uint index, string address, int prefixLength) {
    byte[] a = System.Net.IPAddress.Parse(address).GetAddressBytes();
    if (a.Length != 4 || prefixLength < 8 || prefixLength > 30) throw new Exception("Unexpected hotspot address " + address + "/" + prefixLength);
    uint host = V4(a), mask = 0xFFFFFFFFu << (32 - prefixLength), broadcast = (host & mask) | ~mask;
    Session session = new Session(); session.key = Guid.NewGuid(); session.flags = SessionDynamic; session.display.name = Text("BeerMat quiz Wi-Fi isolation");
    Check(FwpmEngineOpen0(null, AuthnWinNT, IntPtr.Zero, ref session, out engine), "Opening Windows Filtering Platform");
    Check(FwpmTransactionBegin0(engine, 0), "Starting the filter changes");
    try {
      SubLayer s = new SubLayer(); s.key = subLayer; s.display.name = Text("BeerMat quiz Wi-Fi isolation"); s.weight = 0x7FFF;
      Check(FwpmSubLayerAdd0(engine, ref s, IntPtr.Zero), "Adding the BeerMat sublayer");
      Condition here = Number(InterfaceIndex, Uint32, index);
      // Nothing is forwarded to or from the hotspot's phones.
      Add(ForwardV4, "no IPv4 forwarding from phones", Block, 1, Number(SourceInterface, Uint32, index));
      Add(ForwardV4, "no IPv4 forwarding to phones", Block, 1, Number(DestinationInterface, Uint32, index));
      Add(ForwardV6, "no IPv6 forwarding from phones", Block, 1, Number(SourceInterface, Uint32, index));
      Add(ForwardV6, "no IPv6 forwarding to phones", Block, 1, Number(DestinationInterface, Uint32, index));
      // From phones, only packets for the laptop's hotspot address, broadcasts (DHCP) and multicast.
      Add(InboundV4, "phones reach the laptop", Permit, 10, here, Number(LocalAddress, Uint32, host));
      Add(InboundV4, "phones broadcast (DHCP)", Permit, 10, here, Number(LocalAddress, Uint32, 0xFFFFFFFFu));
      Add(InboundV4, "phones broadcast on the quiz network", Permit, 10, here, Number(LocalAddress, Uint32, broadcast));
      Add(InboundV4, "phones multicast", Permit, 10, here, Subnet4(0xE0000000u, 0xF0000000u));
      Add(InboundV4, "nothing else from phones (IPv4)", Block, 1, here);
      Add(InboundV6, "phones reach the laptop (IPv6 link-local)", Permit, 10, here, Subnet6("fe80::", 10));
      Add(InboundV6, "phones multicast (IPv6)", Permit, 10, here, Subnet6("ff00::", 8));
      Add(InboundV6, "nothing else from phones (IPv6)", Block, 1, here);
      // ICS's DNS proxy would look up names on the internet for phones.
      Add(AcceptV4, "no DNS for phones (IPv4)", Block, 15, here, Number(LocalPort, Uint16, 53));
      Add(AcceptV6, "no DNS for phones (IPv6)", Block, 15, here, Number(LocalPort, Uint16, 53));
      Check(FwpmTransactionCommit0(engine), "Saving the filter changes");
    } catch { FwpmTransactionAbort0(engine); Dispose(); throw; }
  }

  public int Count { get { return ids.Count; } }
  // How many of this session's filters Windows still has.
  public int Present() {
    int n = 0;
    foreach (ulong id in ids) { IntPtr f; if (FwpmFilterGetById0(engine, id, out f) == 0) { n++; FwpmFreeMemory0(ref f); } }
    return n;
  }
  public void Dispose() {
    if (engine != IntPtr.Zero) { FwpmEngineClose0(engine); engine = IntPtr.Zero; }
    foreach (IntPtr p in memory) Marshal.FreeHGlobal(p);
    memory.Clear();
  }
}
'@

$state = @{nonce = $Nonce; pid = $PID; state = 'starting'; reason = ''; filters = 0; present = 0; checkedAt = (Now-Ms)}
$manager = $null; $isolation = $null; $started = $false
try {
  Write-State $state
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'The isolation helper is not running as administrator.' }
  Add-Type -TypeDefinition $wfp -Language CSharp
  $settings = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ConfigBase64)) | ConvertFrom-Json
  $found = Get-Manager
  $manager = $found.manager
  if (-not $manager) { throw $found.reason }
  # "up" gave up waiting (the administrator prompt took too long): do not start after all.
  if (Test-Path -LiteralPath $StopPath) { throw 'The quiz Wi-Fi was not started: BeerMat stopped waiting for administrator approval.' }
  if ($manager.TetheringOperationalState -ne 'Off') { $null = Await ($manager.StopTetheringAsync()) $ResultType }
  $apConfig = $manager.GetCurrentAccessPointConfiguration()
  $apConfig.Ssid = $settings.ssid
  $apConfig.Passphrase = $settings.password
  AwaitAction ($manager.ConfigureAccessPointAsync($apConfig))
  $result = Await ($manager.StartTetheringAsync()) $ResultType
  if ($result.Status -ne 'Success') { throw "Windows could not start Mobile Hotspot: $($result.Status) $($result.AdditionalErrorMessage)" }
  $started = $true
  # The adapter appears a moment after the hotspot starts; the filters go on as soon as it has its address.
  $hotspot = $null
  for ($i = 0; $i -lt 60 -and -not $hotspot; $i++) { $hotspot = Get-HotspotInterface; if (-not $hotspot) { Start-Sleep -Milliseconds 250 } }
  if (-not $hotspot) { throw 'Mobile Hotspot started, but its network adapter could not be found, so players could not be kept off the internet. The quiz Wi-Fi was stopped.' }
  try { $isolation = [BeerMatIsolation]::new([uint32]$hotspot.index, $hotspot.address, $hotspot.prefixLength) }
  catch {
    $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
    throw "Players could not be kept off the internet ($($e.Message)), so the quiz Wi-Fi was stopped."
  }
  $state = @{nonce = $Nonce; pid = $PID; state = 'applied'; reason = ''; ssid = $settings.ssid; address = $hotspot.address; prefixLength = $hotspot.prefixLength;
    interfaceIndex = $hotspot.index; adapter = $hotspot.alias; filters = $isolation.Count; present = $isolation.Present(); layers = @($isolation.Names); checkedAt = (Now-Ms)}
  Write-State $state
  $ending = ''
  while (-not $ending) {
    Start-Sleep -Seconds 3
    if (Test-Path -LiteralPath $StopPath) { $ending = 'stopped'; break }
    if ($OwnerPid -and -not (Process-Alive $OwnerPid)) { $ending = 'BeerMat closed, so the quiz Wi-Fi was stopped.'; break }
    if ($manager.TetheringOperationalState -eq 'Off') { $ending = 'Mobile Hotspot was switched off outside BeerMat.'; break }
    $now = Get-HotspotInterface
    if (-not $now -or $now.index -ne $hotspot.index) { $ending = 'Mobile Hotspot moved to another network adapter, so the quiz Wi-Fi was stopped to keep players off the internet.'; break }
    $state.present = $isolation.Present(); $state.checkedAt = Now-Ms
    if ($state.present -ne $state.filters) { $ending = "Windows removed $($state.filters - $state.present) of BeerMat's isolation filters, so the quiz Wi-Fi was stopped to keep players off the internet."; break }
    Write-State $state
  }
  try { Stop-Hotspot $manager } catch {}
  $isolation.Dispose(); $isolation = $null
  $state.state = if ($ending -eq 'stopped') { 'stopped' } else { 'lost' }; $state.reason = if ($ending -eq 'stopped') { 'Quiz Wi-Fi stopped.' } else { $ending }
  $state.present = 0; $state.checkedAt = Now-Ms
  Write-State $state
} catch {
  $message = $_.Exception.Message
  if ($started) { try { Stop-Hotspot $manager } catch {} }
  if ($isolation) { $isolation.Dispose() }
  $state.state = 'failed'; $state.reason = $message; $state.present = 0; $state.checkedAt = Now-Ms
  try { Write-State $state } catch {}
  exit 1
} finally {
  Remove-Item -LiteralPath $StopPath -ErrorAction SilentlyContinue
}
