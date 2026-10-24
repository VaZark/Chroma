# Achroma

A GNOME Shell extension that toggles your display to monochrome/grayscale mode with a single click. 

Useful for reducing eye strain, improving focus, or accessibility. 

## Features

- One-click toggle for monochrome display
- Multiple color profiles to choose from
- Settings persist between sessions
- Lightweight and simple

## Profiles

Two profiles ship by default. They are ordinary profiles: edit or delete them in preferences like any you create.

| Profile | Description |
|---------|-------------|
| Grayscale | Standard full desaturation |
| Soft | Subtle 70% desaturation |

The quick settings menu has Desaturation, Brightness and Contrast sliders. Moving one adjusts the screen live as an unsaved "Custom" profile; picking a saved profile discards it.

## Installation

### From GNOME Extensions Website

1. Visit [Achroma on extensions.gnome.org](https://extensions.gnome.org/extension/9061/achroma/)
2. Click the toggle to install

### Manual Installation

1. Clone or download this repository: 
   ```bash
   git clone https://github.com/ktauchathuranga/achroma.git
   ```

2. Copy to GNOME extensions directory:
   ```bash
   cp -r achroma ~/.local/share/gnome-shell/extensions/achroma@ktauchathuranga.github.io
   ```

3. Compile the schema:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/achroma@ktauchathuranga.github.io/schemas/
   ```

4. Restart GNOME Shell: 
   - On Wayland: Log out and log back in
   - On X11: Press `Alt+F2`, type `r`, press Enter

5. Enable the extension:
   ```bash
   gnome-extensions enable achroma@ktauchathuranga.github.io
   ```

## Usage

| Action | Result |
|--------|--------|
| Left click on icon | Toggle effect on/off |
| Quick settings sliders | Adjust desaturation, brightness and contrast live |
| Extension Preferences | Create, edit, delete and select profiles |

### Opening Preferences

Via command line:
```bash
gnome-extensions prefs achroma@ktauchathuranga.github.io
```

Or via Extension Manager app:  Click the gear icon next to Achroma. 

## Requirements

- GNOME Shell 50 or later

### Reloading the extension

```bash
gnome-extensions disable achroma@ktauchathuranga.github.io && gnome-extensions enable achroma@ktauchathuranga.github.io
```

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue. 
