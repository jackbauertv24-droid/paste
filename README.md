# paste

A one-bookmark escape hatch for copying text out of a terminal that lives
inside a web client.

An agent (or you) runs `paste`; the text is encrypted locally with AES-256-GCM
under a key derived from your PIN, and the ciphertext is pushed to a single
fixed gist. The static viewer page reads that gist and decrypts it in the
browser. Plaintext never leaves the machine that ran `paste`, and the PIN never
goes over the network.

## For agents

If you are an AI agent asked to post something here, read [AGENTS.md](AGENTS.md).
Short version: the `paste` command is already on `PATH` on the operator's machine,
use `paste -t TITLE` or pipe to it, and never read or print the PIN.

## Use

```sh
paste "some text"                # positional
some-command | paste             # stdin
paste -f build.log               # a file
paste -t notes.md -l md "..."    # title and language label
paste --clear                    # empty the inbox
paste --rotate-pin 1234          # new PIN, wipes the inbox
paste --where                    # print the viewer URL
```

Then open the viewer, type the PIN once, and tap **Copy** on any entry.

## What is public

This repository is public; it holds code only. Two things are deliberately kept
out of it:

- **The PIN**, which lives in `~/.paste/pin` at mode 0600 and never crosses the
  network — key derivation happens locally, before anything is uploaded.
- **The gist id**, which reaches the viewer through the URL fragment. Browsers
  never send a fragment to the server, so it stays out of logs, and it is not
  compiled into the published page.

The gist itself is *secret* rather than public: still readable anonymously by
the viewer, but not listed on the owner's profile and not discoverable without
the id. Reaching the contents therefore requires both the bookmark and the PIN.

The inbox keeps the 30 most recent entries.

## Layout

- `bin/paste.mjs` — the CLI (Node 18+, needs an authenticated `gh`)
- `index.html` — the viewer, served by GitHub Pages
- `~/.paste/config.json` — gist id and KDF salt
- `~/.paste/pin` — the PIN, mode 0600
