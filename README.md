# paste

A one-bookmark escape hatch for copying text out of a terminal that lives
inside a web client.

An agent (or you) runs `paste`; the text is encrypted locally with AES-256-GCM
under a key derived from your code, and the ciphertext is pushed to a single
fixed gist. The static viewer page reads that gist and decrypts it in the
browser. Plaintext never leaves the machine that ran `paste`, and the code
never goes over the network.

## For agents

If you are an AI agent asked to post something here, read [AGENTS.md](AGENTS.md).
Short version: the `paste` command is already on `PATH` on the operator's machine,
use `paste -t TITLE` or pipe to it, and never read or print the code.

## Use

```sh
paste "some text"                # positional
some-command | paste             # stdin
paste -f build.log               # a file
paste -t notes.md -l md "..."    # title and language label
paste --clear                    # empty the inbox
paste --set-code "a b c d"       # change the one secret (wipes the inbox)
paste --where                    # print the viewer URL
```

Then open the viewer and tap **Copy** on any entry. The bookmark carries the
code, so it opens in one tap; the same code can be typed on the page instead,
which is what you want on a device where the URL should not be stored.

## What is public

This repository is public; it holds code only. Two things are deliberately kept
out of it:

- **The code**, the single secret. It lives in `~/.paste/pin` at mode 0600 and
  never crosses the network — key derivation happens locally, before anything
  is uploaded. It both opens the directory and decrypts the inbox, so an
  attacker attacks whichever is cheaper per guess; the inbox therefore uses
  4,000,000 PBKDF2 iterations and the directory 8,000,000.
- **The gist address**, which is never written here at all. The URL fragment
  carries a short memorable code instead, and that code decrypts `dir.json`, a
  published directory whose plaintext is the address. Browsers never send a
  fragment to the server, so the code stays out of logs. Publishing an
  encrypted directory is safe: without the code it is only ciphertext.

The gist itself is *secret* rather than public: still readable anonymously by
the viewer, but not listed on the owner's profile and not discoverable without
the address.

The inbox keeps the 30 most recent entries.

## Layout

- `bin/paste.mjs` — the CLI (Node 18+, needs an authenticated `gh`)
- `index.html` — the viewer, served by GitHub Pages
- `~/.paste/config.json` — gist address and KDF salt, no secret
- `~/.paste/pin` — the code, mode 0600
