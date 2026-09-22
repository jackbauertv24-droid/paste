# paste

A one-bookmark escape hatch for copying text out of a terminal that lives
inside a web client.

An agent (or you) runs `paste`; the text is encrypted locally with AES-256-GCM
under a key derived from your PIN, and the ciphertext is pushed to a single
fixed gist. The static viewer page reads that gist and decrypts it in the
browser. Plaintext never leaves the machine that ran `paste`, and the PIN never
goes over the network.

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

The gist is public, so the world can see that ciphertext exists and roughly how
large it is. It cannot see the contents. The inbox keeps the 30 most recent
entries.

## Layout

- `bin/paste.mjs` — the CLI (Node 18+, needs an authenticated `gh`)
- `index.html` — the viewer, served by GitHub Pages
- `~/.paste/config.json` — gist id and KDF salt
- `~/.paste/pin` — the PIN, mode 0600
