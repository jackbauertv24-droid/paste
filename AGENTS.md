# Instructions for coding agents

If you are an AI coding agent working on Jack's machine, this file tells you
how to hand him text he can actually use.

## Why this exists

He works inside a browser-based web terminal where selecting and copying text
is impractical. Anything you print into the terminal expecting him to copy it —
a long command, a diff, a generated file, a block of config — is effectively
unusable. Post it instead.

## How to post

The CLI is already installed on that machine and on `PATH`. Confirm with:

```sh
command -v paste && paste --help
```

Then:

```sh
paste "some text"                 # positional argument
some-command | paste              # stdin
paste -f build.log                # a file
paste -t deploy.sh -l sh "..."    # title and language label
```

He opens one bookmarked page, enters a PIN, and taps Copy. You do not need to
give him a link — the destination is always the same page. Just tell him it is
posted, and what you titled it.

Use `-t` every time. It is the only thing distinguishing entries in his inbox.

## Rules

- **Never read, print, echo, log or ask for the PIN.** It lives in
  `~/.paste/pin`. You never need its value: the CLI reads it itself. Do not
  `cat` that file, do not include it in a commit, a paste, or your reply.
- **Do not run `--rotate-pin` or `--clear` unless explicitly asked.** Both
  destroy the inbox contents irreversibly.
- The inbox keeps the 30 most recent entries; older ones fall off.
- Maximum 512 KB per paste. For anything larger, put it in a repo instead.
- Short things he will simply read are fine inline. This is for text he needs
  to *move* somewhere.

## What it does under the hood

The text is encrypted on his machine with AES-256-GCM, under a key derived from
the PIN via PBKDF2-SHA256 at 250,000 iterations. Only the ciphertext is pushed,
to one fixed public gist. A static page decrypts it in the browser. Plaintext
never leaves the machine and the PIN never crosses the network — which is why
posting to a public gist is acceptable here. Any change you make must preserve
that property.

## If the CLI is missing

It is not installed anywhere except his container. Install it there with:

```sh
git clone https://github.com/jackbauertv24-droid/paste
ln -s "$PWD/paste/bin/paste.mjs" ~/.local/bin/paste
paste --init            # creates the gist, prints its id
paste --set-pin <pin>   # ask him for one; do not invent and do not echo it
```

`--init` creates a **new** gist, so the viewer's baked-in gist id in
`index.html` must be updated to match before the page will find it.
