// What scripts/hotspot-windows.ps1 must keep doing to keep players off the internet. These read the script; they run
// nothing on Windows and are no proof that Windows blocks anything (docs/DESKTOP.md, "Checking it on Windows").
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script = readFileSync(new URL('../scripts/hotspot-windows.ps1', import.meta.url), 'utf8');
const code = script.split('\n').filter(l => !/^\s*(#|\/\/)/.test(l)).join('\n');
const filters = [...code.matchAll(/Add\((\w+), "([^"]+)", (Block|Permit), (\d+)/g)].map(([, layer, name, action, weight]) => ({layer, name, action, weight: +weight}));

test('the filters live in a dynamic WFP session, so Windows removes them whenever the helper ends', () => {
  assert.match(code, /SessionDynamic = 1/);
  assert.match(code, /session\.flags = SessionDynamic/);
  assert.match(code, /FwpmTransactionCommit0/);
  // Nothing persistent or system-wide: no firewall rules, no interface or routing changes, no ICS settings written.
  for (const persistent of [/New-NetFirewallRule/i, /netsh/i, /Set-NetIPInterface/i, /New-NetRoute/i, /Set-ItemProperty/i, /FWPM_FILTER_FLAG_PERSISTENT|flags = 1;/]) assert.doesNotMatch(code, persistent);
});

test('forwarding is blocked both ways for IPv4 and IPv6, and phones only reach the laptop\'s hotspot address', () => {
  for (const layer of ['ForwardV4', 'ForwardV6']) {
    assert.equal(filters.filter(f => f.layer === layer && f.action === 'Block').length, 2, layer);
  }
  assert.match(code, /Add\(ForwardV4, "[^"]+", Block, 1, Number\(SourceInterface, Uint32, index\)\)/);
  assert.match(code, /Add\(ForwardV4, "[^"]+", Block, 1, Number\(DestinationInterface, Uint32, index\)\)/);
  for (const layer of ['InboundV4', 'InboundV6']) {
    const block = filters.find(f => f.layer === layer && f.action === 'Block'), permits = filters.filter(f => f.layer === layer && f.action === 'Permit');
    assert.ok(block && permits.length, layer);
    // A permit only wins in the sublayer when it outweighs the catch-all block.
    for (const permit of permits) assert.ok(permit.weight > block.weight, permit.name);
  }
  assert.match(code, /Add\(InboundV4, "phones reach the laptop", Permit, 10, here, Number\(LocalAddress, Uint32, host\)\)/);
  // ICS's DNS proxy is closed to phones, above the "reach the laptop" permit.
  for (const layer of ['AcceptV4', 'AcceptV6']) assert.ok(filters.some(f => f.layer === layer && f.action === 'Block' && f.weight > 10 && /DNS/.test(f.name)), layer);
  assert.match(code, /Number\(LocalPort, Uint16, 53\)/);
});

test('the WFP layer and condition keys are the ones in fwpmu.h', () => {
  const keys = {InboundV4: 'c86fd1bf-21cd-497e-a0bb-17425c885c58', InboundV6: 'f52032cb-991c-46e7-971d-2601459a91ca', ForwardV4: 'a82acc24-4ee1-4ee1-b465-fd1d25cb10a4',
    ForwardV6: '7b964818-19c7-493a-b71f-832c3684d28c', AcceptV4: 'e1cd9fe7-f4b5-4273-96c0-592e487b8650', AcceptV6: 'a3b42c97-9f04-4672-b87e-cee9c483257f',
    LocalAddress: 'd9ee00de-c1ef-4617-bfe3-ffd8f5a08957', LocalPort: '0c1ba1af-5765-453f-af22-a8f791ac775b', InterfaceIndex: '667fd755-d695-434a-8af5-d3835a1259bc',
    SourceInterface: '2311334d-c92d-45bf-9496-edf447820e2d', DestinationInterface: '35cf6522-4139-45ee-a0d5-67b80949d879'};
  for (const [name, key] of Object.entries(keys)) assert.match(code, new RegExp(`${name} = new Guid\\("${key}"\\)`), name);
});

test('no fallback to a hotspot that shares the internet', () => {
  const serve = code.slice(code.indexOf("$state = @{nonce = $Nonce"));
  // Started only by the administrator helper, after the filter code has compiled; stopped whenever isolation fails.
  assert.ok(serve.indexOf('Add-Type -TypeDefinition $wfp') < serve.indexOf('StartTetheringAsync'));
  assert.equal((code.match(/StartTetheringAsync/g) || []).length, 1);
  assert.match(serve, /if \(\$started\) \{ try \{ Stop-Hotspot \$manager \}/);
  for (const reason of ['adapter could not be found', 'could not be kept off the internet', 'BeerMat closed', 'moved to another network adapter', "isolation filters, so the quiz Wi-Fi was stopped"]) assert.ok(serve.includes(reason), reason);
  // "up" refuses when the administrator prompt is declined or the helper never answers, and makes sure it is off.
  const up = code.slice(code.indexOf("if ($Action -eq 'up')"), code.indexOf('$wfp = @'));
  assert.match(up, /-Verb RunAs/);
  assert.match(up, /was not started/);
  assert.match(up, /Stop-Hotspot \$found\.manager/);
});

test('status says "configured" only for a live helper with fresh checks on the hotspot\'s current adapter', () => {
  const isolation = code.slice(code.indexOf('function Get-Isolation'), code.indexOf('$cards = @('));
  for (const part of ["$state.state -eq 'applied'", '$alive', '$fresh', '$same', '$state.present -eq $state.filters']) assert.ok(isolation.includes(part), part);
  assert.match(isolation, /-lt 20000/);
  // The address comes from the adapter (or ICS's ScopeAddress), not a constant.
  assert.match(code, /ScopeAddress/);
  assert.match(code, /address = if \(\$hotspot\) \{ \$hotspot\.address \}/);
});
