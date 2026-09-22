# Instructions for coding agents

If you are an AI coding agent working on the operator's machine, this file
tells you how to hand them text they can actually use.

## Why this exists

The operator works inside a browser-based web terminal where selecting and
copying text is impractical. Anything you print into the terminal expecting it
to be copied by hand — a long command, a diff, a generated file, a block of
config — is effectively unusable. Post it instead.

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

The destination is one fixed bookmarked page, unlocked with a code, with a Copy
button per entry. You do not need to supply a link — it is always the same
page. Just say that it is posted, and what you titled it.

**Do not print the output of `paste --where`** unless asked. That URL's
fragment contains the code itself, which is the only secret protecting the
inbox and is kept out of this repository on purpose.

Use `-t` every time. It is the only thing distinguishing entries in the inbox.

## Rules

- **Never read, print, echo, log or ask for the code.** It lives in
  `~/.paste/pin`. You never need its value: the CLI reads it itself. Do not
  `cat` that file, and do not put it in a commit, a paste, or your reply.
- **Do not run `--set-code` or `--clear` unless explicitly asked.** Both
  destroy the inbox contents irreversibly.
- **Never use a real code, address or secret as an example** in code, comments,
  commit messages or documentation. This repository is public and its history
  is permanent.
- The inbox keeps the 30 most recent entries; older ones fall off.
- Maximum 512 KB per paste. For anything larger, use a repo instead.
- Short things that will simply be read are fine inline. This is for text that
  needs to *move* somewhere.

## What it does under the hood

The text is encrypted locally with AES-256-GCM, under a key derived from the
code via PBKDF2-SHA256 at 4,000,000 iterations. Only the ciphertext is pushed, to
one fixed public gist. A static page decrypts it in the browser. Plaintext
never leaves the machine and the code never crosses the network — which is why
posting to a public gist is acceptable here. Any change you make must preserve
that property.

## If the CLI is missing

It is installed only on the operator's own container. Install it there with:

```sh
git clone https://github.com/jackbauertv24-droid/paste
ln -s "$PWD/paste/bin/paste.mjs" ~/.local/bin/paste
paste --init            # creates the gist, prints its id
paste --set-code "a b c d"    # ask for one; do not invent it, do not echo it
```

`--init` creates a **new** secret gist. The id is not compiled into the page;
the viewer reads it from the URL fragment and remembers it per device, so the
bookmark from `paste --where` is what makes the page work.
