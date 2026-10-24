# Contributing to Chroma

Contributions are welcome. Open an issue first for anything larger than a small fix, so we can agree on the approach.

## Development setup

### 1. Symlink the repo into your extensions directory

Link the working copy instead of copying it, so edits take effect without reinstalling:

```bash
git clone git@github.com:VaZark/Chroma.git
ln -s "$PWD/Chroma" ~/.local/share/gnome-shell/extensions/chroma@vazark.github.io
```

The link name must match the `uuid` in `metadata.json`, or GNOME Shell will not find the extension.

### 2. Compile the schema

Settings are read through a compiled schema, so recompile after any change to `schemas/*.gschema.xml`:

```bash
glib-compile-schemas schemas/
```

### 3. Enable the extension

```bash
gnome-extensions enable chroma@vazark.github.io
```

## Testing in a nested session

GNOME Shell on Wayland cannot reload an extension in place, and logging out after every change is slow. Run a nested Shell in a window instead.

Install `mutter-devkit`, which provides the window the nested Shell renders into. Then start the nested session:

```bash
dbus-run-session gnome-shell --devkit --wayland
```

`dbus-run-session` gives it a private session bus, so it cannot disturb your real desktop. Because of the symlink, closing the window and running the command again picks up your latest code.

Notes:

- Extension settings are stored in dconf, which the nested session shares with your desktop. Settings you change while testing are visible in your real session.
- Extension errors show up in the same terminal. 

## Code style

- Match the surrounding code: naming, indentation and comment density.
- Comments explain *why* a decision was made, not what the code does. Add one where the reason is not obvious, such as a workaround or a constraint from GNOME Shell.

## Pull requests

- Must be linked to an issue
- Keep each pull request focused on one change.
- Describe what you tested and how, for example in the nested session.
- Note any schema change, since it needs a recompile.
