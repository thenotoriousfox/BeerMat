# BeerMat for Windows and Linux

The desktop app runs the whole quiz from one laptop: the quiz server, the quiz desk in its own window, and the TV
display full screen on a second screen. Nothing else needs installing: no Node.js, terminal or browser.

## Installing

Download from the latest release: <https://github.com/DTJW92/BeerMat/releases/latest> (`SHA256SUMS.txt` there has
each file's checksum).

| System | File | How |
|---|---|---|
| Windows 10/11 | `BeerMat-Setup-0.5.1.exe` | Run it, choose where to install. Start menu and desktop shortcuts are added. |
| Windows, no install | `BeerMat-0.4.0-portable.exe` | Run it from anywhere (a USB stick). Data still goes in your user folder. |
| Linux (CachyOS, Arch, Ubuntu, Fedora…) | `BeerMat-0.4.0.AppImage` | `chmod +x BeerMat-0.4.0.AppImage`, then run it. |
| Linux, unpacked | `beermat-0.4.0.tar.gz` | Unpack anywhere and run `beermat`. |

The builds are **not code-signed yet**. Windows SmartScreen warns about an unknown publisher (More info → Run
anyway) until the installer is signed with a code-signing certificate (see "Building", below).

**Updating:** BeerMat Desk looks for a new version when it starts and twice a day (it needs the internet: the
venue's Wi-Fi, or the quiz Wi-Fi with the laptop still on its own). When one is out, the top bar says so and
**Settings → Updates** offers it; nothing happens until you say, and never while a question is open. Installed on
Windows, **Update and restart** runs the new installer silently and starts the new desk; the Linux AppImage swaps
itself for the new one in place. The Windows zip and the Linux tar.gz say a new version is out and open the download
page. Your quizzes, settings and key are in your user folder, not the program folder, so they carry over.

How it's kept safe: each release publishes `latest.json` on downloads.beermatquiz.co.uk, signed with BeerMat's
release key (`scripts/update-manifest.mjs`, the `UPDATE_KEY` secret; the public half is in `shared/update.js`, and the
maintainer's copy of the private key is `~/.local/share/beermat/update-key.txt`). The desk's quiz server only believes
a manifest signed with it, and only installs a file whose size and SHA-256 match it (`server/updates.js`).

## First run

The app makes a long random **quizmaster key** for you and keeps it in the system keychain (Windows: DPAPI; Linux:
the Secret Service, e.g. KWallet or GNOME Keyring; if there is none, a file only your account can read). You only
need it to open the desk somewhere else: **BeerMat → Show quizmaster key**.

It then asks how players will join:

* **Venue Wi-Fi or network**: phones on the venue's own Wi-Fi open this laptop's address, shown on the TV with a
  QR code. Nothing on the router is changed.
* **BeerMat Wi-Fi from this laptop**: the laptop makes its own quiz Wi-Fi (see "Quiz Wi-Fi", below).

You can change this any time on the desk under **How players join**.

## The TV screen

Plug in a TV or projector as a second screen (extended, not mirrored). The app:

* opens the desk on the main screen and the TV display full screen on the other screen, by itself;
* remembers which screen is the TV (by its name, so it is found again after unplugging);
* follows screens being plugged in and out: if the TV is unplugged mid-quiz, the display carries on in a window on
  the laptop; when it is back, it goes full screen there again;
* with one screen, opens the TV as a preview window when you ask (**TV → Preview the TV in a window**, or **F7**).

On the desk, **Screens** (and the **TV** menu) choose the TV screen, swap the desk and TV screens, blank the TV
(**F8**: black and silent, the quiz carries on underneath) and switch the automatic opening off. The TV window is a
separate, locked-down page: it never has the desk's login and cannot show answers before they are revealed.

**TV sound.** The TV window's sounds (reveals, buzzers, bingo calls, songs) and the desk's Spotify player play
through the TV's own sound output, while the desk's sounds stay on the laptop. Each page chooses its output itself
(Chromium's `setSinkId`), so the system's sound settings are never changed. **Automatic** (the default) uses an
HDMI or DisplayPort output whenever the TV is full screen on its own screen, and the laptop's output for a preview
window; **TV sound** under Screens can name an output instead (remembered by name) or keep everything on the
laptop. A TV whose sound output appears a moment after its picture is picked up a few seconds later. Spotify's player
lives in a frame from Spotify's own site, so the app sets that frame's output from the main process; how Spotify
plays inside its frame is undocumented, so check it once with a real song.

On Linux the app runs through XWayland on Wayland desktops (KDE Plasma, GNOME), because Wayland does not let an app
put a window on a chosen screen. Set `BEERMAT_WAYLAND=1` to run natively on Wayland instead (then move the TV window
yourself).

## How players join

* **Venue Wi-Fi / LAN**: under **How players join**, choose *On the venue's own Wi-Fi or network*, pick this
  laptop's address and type the venue's Wi-Fi name, then **Use for joining**. **Check the connection** tests that
  BeerMat answers on that address and looks for the usual blockers:
  * *Windows Firewall*: the first time BeerMat runs, Windows asks whether to allow it: tick **Private networks**. If
    the venue's network is set to **Public**, Windows blocks phones: set it to Private (Settings → Network → the
    network), or allow BeerMat on Public networks.
  * *Linux*: firewalld or ufw, if running, need the quiz port allowed (the check prints the command).
  * *Client isolation*: guest and public Wi-Fi often keeps devices apart, so phones cannot reach the laptop at all.
    Nothing on the laptop can fix that; ask for a network without it (often the staff Wi-Fi), or use the quiz Wi-Fi.
* **Quiz Wi-Fi from this laptop**: **Quiz night → Start quiz Wi-Fi**.
  * *Linux*: as before (`scripts/hotspot.py`): an open network, with a sign-in window that opens the quiz by itself
    on most phones. Asks for your password. The laptop can stay on your own Wi-Fi.
  * *Windows*: Windows' own **Mobile Hotspot**, kept off the internet (below). Differences you should know:
    * it always has a password (8–63 characters); the TV shows a Wi-Fi QR code with it, plus a second code for
      the quiz address (normally `http://192.168.137.1:3000`; BeerMat reads the address the hotspot's adapter really
      got, so a changed ICS address works too). There is no sign-in window.
    * Windows only starts it while the laptop is connected to some network (it shares that connection). A laptop
      with no network at all needs a network cable, a phone's hotspot or a second Wi-Fi adapter, or use the venue
      Wi-Fi instead. The desk says so when it happens.
    * **Start quiz Wi-Fi asks for administrator approval** (one UAC prompt) to keep players off the internet. Say no
      and the quiz Wi-Fi does not start. Stopping needs no approval. **Stop quiz Wi-Fi** or closing BeerMat (even if
      it crashes) turns it off again.
    * not every Wi-Fi card can share while connected; the desk shows Windows' reason when it refuses.
* **Online**: **Go online**, as before. Install cloudflared first (Windows: `winget install Cloudflare.cloudflared`).

## Windows quiz Wi-Fi: no internet for players

**Why it needs anything at all.** Mobile Hotspot is Internet Connection Sharing (ICS): it NATs phones onto the
laptop's own connection and runs a DHCP server and a DNS proxy for them. Neither the WinRT tethering API nor ICS has a
"local network only" setting, and Windows refuses to start the hotspot without a connection to share. Ordinary Windows
Firewall rules only apply to traffic to and from the laptop itself, not to what ICS forwards, so they cannot stop it
either.

**What BeerMat does** (`scripts/hotspot-windows.ps1`). Starting the quiz Wi-Fi launches a small helper as
administrator. The helper starts Mobile Hotspot itself, finds the hotspot's adapter (the Wi-Fi Direct virtual adapter
holding ICS's address) and, within about a second, adds Windows Filtering Platform (WFP) filters in a *dynamic* WFP
session, matched on that adapter only:

| Layer | Filter |
|---|---|
| IP forward, IPv4 and IPv6 | block everything forwarded from or to the hotspot's phones (both directions) |
| Inbound IP packet, IPv4 | from phones, allow only packets for the laptop's hotspot address, broadcast (DHCP) and multicast; block the rest, including the laptop's other addresses |
| Inbound IP packet, IPv6 | allow only link-local and multicast; block the rest |
| Receive/accept, IPv4 and IPv6 | block DNS (port 53) from phones, so ICS's DNS proxy cannot look names up on the internet for them |

So phones keep DHCP and everything on the laptop's hotspot address (the quiz on port 3000, its WebSocket and SSE
updates), and cannot reach the internet by IPv4, IPv6, a direct IP address or DNS. The laptop's own internet and its
other networks are untouched: every filter is tied to the hotspot adapter.

Nothing persists. Dynamic WFP filters are deleted by Windows when the helper's process ends, however it ends. No
firewall rule, route, interface setting or ICS setting is written, and starting again first stops any earlier helper.
The helper checks every 3 seconds that its filters are still there and the hotspot is on the same adapter; if not, or
if BeerMat quits or crashes, it switches the hotspot off. If the filters cannot be added, the hotspot is switched off
again with the reason: BeerMat never falls back to a hotspot that shares the internet.

**What the desk shows**, separately (Tonight → Quiz night): quiz Wi-Fi on (adapter and address), devices connected,
BeerMat answering at the hotspot address, internet isolation on (the helper is running, checked its filters in the
last 20 seconds, on the hotspot's current adapter), and isolation **checked**: each phone that joins tries
`http://1.1.1.1`, `http://[2606:4700:4700::1111]` and `http://neverssl.com` once and reports whether it got through.
Isolation counts as checked only once phones report and none got through. A phone that got through is shown as a
failure (it may have used its mobile data). If the filters are not on — the helper was killed, or Mobile Hotspot was
started from Windows Settings instead of BeerMat — the desk and the pre-quiz checks warn in red. Linux is unchanged
(`hotspot.py` already blocks forwarding with nftables).

**Limitations.** One UAC prompt per start (WFP needs administrator rights; there is no unprivileged way). Mobile
Hotspot still needs some network to share before Windows will start it, although phones get none of it. The filters
go on a moment (well under a second) after the hotspot starts, before a phone can normally finish joining. Phones see
"No internet" for the network: they stay on it, but some Android phones ask whether to stay connected, and phones with
mobile data on use that for the internet, which BeerMat cannot prevent. This depends on Windows behaviour that the
automated tests cannot exercise (they check the script's filter set and the desk's logic only), so it must be checked
on a real Windows laptop:

### Checking it on Windows

1. Start the quiz Wi-Fi from the desk; approve the UAC prompt. The desk shows "Internet isolation on: 14 filters".
   `netsh wfp show filters` (as administrator) lists filters named "BeerMat quiz Wi-Fi: …".
2. A Windows laptop and an iPhone with mobile data **off** join the quiz Wi-Fi and play a round (answers, buzzer,
   live updates).
3. On the Windows client: `ping 1.1.1.1`, `curl http://1.1.1.1`, `curl -6 http://[2606:4700:4700::1111]`,
   `nslookup example.com 192.168.137.1` and `nslookup example.com 8.8.8.8` all fail; `curl http://192.168.137.1:3000`
   works. On the iPhone, Safari cannot open any website. The desk shows isolation **checked**.
4. The quizmaster laptop still browses the internet throughout.
5. Stop the quiz Wi-Fi: `netsh wfp show filters` has no BeerMat filters left. Start and stop five times: still none
   while stopped, exactly one set while on.
6. While on, end BeerMat in Task Manager: the hotspot goes off within a few seconds and the filters are gone. Kill
   only the administrator `powershell.exe` helper: the filters are gone, and the desk warns that isolation is not on.
7. Decline the UAC prompt: the quiz Wi-Fi does not start, and the desk says why.

## Your data

A folder from before the rename (`BeerMat`) moves to `BeerMat` the first time the app starts, with everything in it.

| | Windows | Linux |
|---|---|---|
| Quiz database, media, sound pack, backups | `%APPDATA%\BeerMat` | `~/.config/BeerMat` |
| Logs (`beermat.log`, `server.log`) | `%APPDATA%\BeerMat\logs` | `~/.config/BeerMat/logs` |

**BeerMat → Open data folder / Open logs** opens them.

* The quiz saves as it goes. Each time the app starts it checks the database and keeps a copy in `backups/` (the
  newest ten).
* If the database is ever damaged, the app moves it aside (it is never deleted) and carries on from the newest good
  copy, and tells you.
* **Back up the quiz…** saves a copy wherever you like; **Restore a backup…** puts one back (the current quiz is
  backed up first).
* Quiz files (**Download quiz with media**, **Load a quiz file**) still move quizzes between laptops, including to
  and from the browser version.

## When something goes wrong

* **The quiz server stops**: the app restarts it straight away and reloads the desk and TV; teams carry on where they
  were. After three failures in a minute it asks you, with a button to open the logs.
* **Port in use**: if something else already uses port 3000 (another BeerMat started from a terminal, say), the app
  uses the next free port and tells you. The quiz Wi-Fi and the TV's join screen follow the new port.
* **Opening BeerMat twice** brings the open window to the front.
* **The desk in a browser** (fallback, or a second device): **BeerMat → Open the desk in a browser** and the
  quizmaster key. The Linux scripts in `scripts/` also still work without the app.
* **Spotify**: the app is built on castlabs' Electron for Content Security (Electron with Widevine), so the desk's own
  Spotify player (**🎵 Start Spotify player on this desk**) works inside the app. Widevine is Google's protected-media
  module: the app downloads it by itself the first time it runs with internet (it is not shipped in the app) and the
  quiz never waits for it; the log says "Widevine ready". Offline, use the Spotify app on the laptop instead.

## Building

Releases build themselves: push a tag matching `package.json`'s version (`git tag v0.4.0 && git push origin v0.4.0`)
and `.github/workflows/release.yml` builds Windows (on Windows) and Linux, runs the tests, and publishes a GitHub
release with the four files, the Android BeerMat app APK (docs/MOBILE.md) and their checksums. Running the
workflow by hand (Actions → Release) builds without publishing; the files are on the run's page.

The same files are then copied to `https://downloads.beermatquiz.co.uk/<version>/` (the `beermat-downloads` bucket
in Cloudflare R2, where the website's download page links) and the website is redeployed with the new version. That
needs the repository's `CLOUDFLARE_API_TOKEN` secret (a Cloudflare token allowed to edit R2 and Workers) and its
`CLOUDFLARE_ACCOUNT_ID` variable. The download page stays on "Downloads open soon" until `DOWNLOADS_READY` in
`site/src/consts.ts` is `true`.

To build by hand, you need Node 22.13+ and npm on the build machine only.

```bash
npm ci
npm run dist:linux        # dist/BeerMat-<v>.AppImage and beermat-<v>.tar.gz
npm run dist:win          # dist/BeerMat-Setup-<v>.exe and BeerMat-<v>-portable.exe (on Linux this uses Wine)
npm run desktop           # run from source
```

Electron comes from castlabs' releases (`github:castlabs/electron-releases#v<version>+wvcus`), which npm 12 only
fetches because `.npmrc` sets `allow-git=root`; electron-builder downloads the matching castlabs build
(`build.electronDownload`). `npm ci` may report blocked install scripts (npm 12+); approve Electron's with
`npm install-scripts approve electron`. If `node_modules/electron/dist` ends up nearly empty, unzip the cached
`~/.cache/electron/*/electron-v<version>+wvcus-linux-x64.zip` into it and write `electron` to
`node_modules/electron/path.txt`.

**Spotify on Windows needs a Widevine (VMP) signature.** Widevine on Windows only plays for apps signed through
castlabs' free Electron Verified Media Path service: create an account (`python3 -m pip install castlabs-evs`, then
`python3 -m castlabs_evs.account signup`) and sign the unpacked app before the installer is made
(`python3 -m castlabs_evs.vmp sign-pkg dist/win-unpacked`, e.g. from an electron-builder `afterPack` hook). This
must happen after code signing. Not done yet, so the Windows build's desk player will probably be refused; the
Spotify app on the laptop still works. Linux needs no VMP signature.

Signing (not done; needs credentials):

* **Windows**: an OV or EV code-signing certificate. Set `CSC_LINK` (the .pfx) and `CSC_KEY_PASSWORD` before
  `npm run dist:win`, or use Azure Trusted Signing (electron-builder's `win.azureSignOptions`). EV certificates or
  Trusted Signing avoid most SmartScreen warnings.
* **Linux**: AppImages are usually distributed unsigned; publish SHA-256 checksums alongside them.

## What has been checked

See [TESTING.md](TESTING.md). In short: the desktop app (source and the packaged Linux build) starts, opens the desk
logged in, opens and blanks the TV preview, restarts a killed quiz server without losing teams, hands over to an
already running copy, and reopens a quiz, all automated on a private virtual screen. Choosing and following screens is
tested with simulated screens. **Not yet checked by a person**: the Windows hotspot's internet isolation (above), a
real second screen/projector, and the first-run window.
