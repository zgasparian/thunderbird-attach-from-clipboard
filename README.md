# Attach from Clipboard (GNOME file-manager fix)

A fixed fork of the Thunderbird add-on **Attach from Clipboard** (original author:
Michael Ganss, id `clipboard@ganss.org`). It adds support for attaching **files
copied in a GNOME-style file manager** (Nautilus, Nemo, Thunar, ...), which the
original add-on could not do on Linux (tested with the Thunderbird snap on Wayland).

Built and debugged by **Zareh Kasparian with Claude (Anthropic) support**.

## Use

1. Copy one or several files in your file manager (or an image / text).
2. In a Thunderbird compose window press **Ctrl+Shift+Insert**
   (or use File → Attach → Attach from Clipboard, or the toolbar button).
3. The files are attached immediately. If something can't be read, a small
   window lists what was found and shows diagnostic details.

The shortcut can be changed in Add-ons → gear icon → Manage Extension Shortcuts.

## Install

Download `attach_from_clipboard-<version>-tb.xpi` from the
[Releases](../../releases) page, then in Thunderbird:
Add-ons → gear icon → **Install Add-on From File**.

Note: the `.xpi` is not signed by Mozilla. Release builds of Thunderbird may
refuse unsigned add-ons unless signature checking is relaxed.

## What was broken and how it was fixed

Copied files in the file manager are put on the clipboard only as
`x-special/gnome-copied-files` (a `copy\nfile:///path` list). Thunderbird's web
clipboard APIs (`navigator.clipboard.read`, paste events) cannot see that
format, so the original add-on found "nothing" and attached nothing.

| Problem | Fix |
|---|---|
| Copied files invisible to web clipboard APIs | New privileged API `AttachMenu.readCopiedFiles` reads the `x-special/gnome-copied-files` flavour and loads the files from disk |
| Clipboard text arrives as raw bytes decoded wrongly (UTF-16), so paths with non-ASCII (e.g. Arabic) names were garbled | Parse the text both as-is and rebuilt from bytes as UTF-8 and use whichever yields files |
| `TextDecoder` / `URL` not defined in the privileged scope | Use `window.TextDecoder`, parse `file://` paths manually |
| One unreadable file made the whole multi-file attach fail | Files are read individually; failures are reported, the rest still attach |
| Experiment API errors were hidden as "An unexpected error occurred" | The API never throws; it returns results plus diagnostics |
| `clipboard.read({unsanitized})` failure aborted everything | Retry with a plain read, filter unsupported types |
| Default shortcut Ctrl+Shift+I | Changed to Ctrl+Shift+Insert |
| Hard to know which build is installed | Version bumped each build and shown in notifications / error window |

## Security notes

- Files are read only on your action (shortcut / menu).
- Only files below your home folder are attached; hidden folders (`.ssh`,
  `.gnupg`, ...) and `..` paths are refused.
- Diagnostics never include clipboard text.
- The add-on makes no network requests; updates come from this repo's
  `updates.json`, so protect the GitHub account (2FA).

## Files

- `src/` – the add-on source (`background.js`, `clipboard.mjs`, `api/AttachMenu/`, ...)
- Release assets – the packaged `.xpi`

## Credits and licence

Original add-on: Michael Ganss (<https://www.updatestar.com/dl/clipboard/clipboard.html>).
The privileged menu-injection code derives from Thunderbird's experiment
examples (MPL 2.0). This fork keeps the original authorship; see the original
project for its licence terms.
