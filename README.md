# Chroma

A GNOME Shell extension that tunes your display's saturation, brightness, contrast and tint from quick settings.

Useful for reducing eye strain, improving focus, or accessibility.

## Features

- One-click toggle from quick settings
- Live sliders for desaturation, brightness and contrast
- Save, edit and delete your own profiles
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

### Manual Installation

1. Clone or download this repository: 
   ```bash
   git clone https://github.com/VaZark/Chroma.git
   ```

2. Copy to GNOME extensions directory:
   ```bash
   cp -r Chroma ~/.local/share/gnome-shell/extensions/chroma@vazark.github.io
   ```

3. Compile the schema:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/chroma@vazark.github.io/schemas/
   ```

4. Restart GNOME Shell: 
   - On Wayland: Log out and log back in
   - On X11: Press `Alt+F2`, type `r`, press Enter

5. Enable the extension:
   ```bash
   gnome-extensions enable chroma@vazark.github.io
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
gnome-extensions prefs chroma@vazark.github.io
```

Or via Extension Manager app:  Click the gear icon next to Chroma. 

## Requirements

- GNOME Shell 50 or later

### Reloading the extension

```bash
gnome-extensions disable chroma@vazark.github.io && gnome-extensions enable chroma@vazark.github.io
```

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue. 

## Credits

Chroma is a fork of [Achroma](https://github.com/ktauchathuranga/achroma) by [ktauchathuranga](https://github.com/ktauchathuranga). Thanks to the original author for the foundation this extension is built on.
