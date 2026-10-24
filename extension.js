'use strict';

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Cogl from 'gi://Cogl';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import { DEFAULT_PROFILES } from './profiles.js';

// Custom tint shader that properly blends with original colors.
const TintEffect = GObject.registerClass(
    class TintEffect extends Clutter.ShaderEffect {
        _init(params = {}) {
            const tint = params.tint || { r: 255, g: 220, b: 180, a: 40 };
            const f = v => (v / 255.0).toFixed(6);
            const snippet = Cogl.Snippet.new(
                Cogl.SnippetHook.FRAGMENT,
                '',
                `cogl_color_out.rgb = mix(cogl_color_out.rgb, vec3(${f(tint.r)}, ${f(tint.g)}, ${f(tint.b)}) * cogl_color_out.a, ${f(tint.a)});`
            );
            super._init();
            this._snippet = snippet;
            this._tintColor = tint;
        }

        vfunc_get_static_snippet() {
            return this._snippet;
        }

        get tint() {
            return this._tintColor;
        }
    });

const EFFECT_DESAT = 'achroma-effect-desat';
const EFFECT_BC = 'achroma-effect-bc';
const EFFECT_TINT = 'achroma-effect-tint';

const AchromaIndicator = GObject.registerClass(
    class AchromaIndicator extends QuickSettings.QuickMenuToggle {
        _init(extensionObject) {
          super._init({
                 title: 'Achroma',
                 iconName: 'applications-graphics-symbolic',
                 toggleMode: true,
             });

            this._extensionObject = extensionObject;
            this._settings = extensionObject.getSettings();
            this.checked = false; // Start safe

             this.menu.setHeader(
                 'applications-graphics-symbolic',
                 'Achroma',
                 null
             );

             this.connect('clicked', () => {
                 if (this.checked)
                     this._refreshEffect();
                 else
                     this._disableEffect();
             });
            this._buildMenu();

            // 1. Standard Profile Change
            this._settingsChangedId = this._settings.connect('changed::current-profile', () => {
                this._updateMenuState();
                // Only update if we are NOT previewing.
                // If we are previewing, the preview logic handles the display.
                if (this.checked && !this._settings.get_boolean('is-previewing')) {
                    this._refreshEffect();
                }
            });

            // 2. Custom Profile List Change
            this._customProfilesId = this._settings.connect('changed::custom-profiles', () => {
                this._buildMenu();
            });

            // 3. Live Preview Logic
            this._previewModeId = this._settings.connect('changed::is-previewing', () => {
                const isPreviewing = this._settings.get_boolean('is-previewing');
                if (isPreviewing) {
                    // Enter Preview Mode
                    this._applyPreview();
                } else {
                    // Exit Preview Mode -> Revert to state
                    this._disableEffect(); // Clear preview
                    if (this.checked) {
                        this._refreshEffect(); // Restore active profile if it was on
                    }
                }
            });

            this._previewDataId = this._settings.connect('changed::preview-profile', () => {
                if (this._settings.get_boolean('is-previewing')) {
                    this._applyPreview();
                }
            });
        }

        _getAllProfiles() {
            const profiles = { ...DEFAULT_PROFILES };
            try {
                const customJson = this._settings.get_string('custom-profiles');
                const customList = JSON.parse(customJson);
                customList.forEach(p => {
                    if (p.id && p.name) profiles[p.id] = p;
                });
            } catch (e) { console.error(e); }
            return profiles;
        }

        _buildMenu() {
            this.menu.removeAll();

          // Profiles
            const profiles = this._getAllProfiles();
            const currentProfileKey = this._settings.get_string('current-profile');
            this._profileItems = {};

            for (const [key, profile] of Object.entries(profiles)) {
                const item = new PopupMenu.PopupMenuItem(profile.name);
                if (key === currentProfileKey) item.setOrnament(PopupMenu.Ornament.DOT);

                item.connect('activate', () => {
                    this._settings.set_string('current-profile', key);
                    if (!this.checked) {
                        this.checked = true;
                        this._refreshEffect();
                    }
                });

                this._profileItems[key] = item;
                this.menu.addMenuItem(item);
            }
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const settingsItem = this.menu.addAction(
                'Preferences',
                () => this._extensionObject.openPreferences()
            );
            settingsItem.visible = Main.sessionMode.allowSettings;
            this.menu._settingsActions[this._extensionObject.uuid] = settingsItem;
        }

        _updateMenuState() {
            const currentProfileKey = this._settings.get_string('current-profile');
            for (const [key, item] of Object.entries(this._profileItems || {})) {
                item.setOrnament(key === currentProfileKey ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            }
        }

        // --- Effect Application Logic ---

        _refreshEffect() {
            const profile = this._getCurrentProfile();
            this._applyEffectData(profile);
        }

        _applyPreview() {
            try {
                const raw = this._settings.get_string('preview-profile');
                const profile = JSON.parse(raw);
                this._applyEffectData(profile);
            } catch (e) {
                console.error('Achroma: Bad preview data', e);
            }
        }

        _getCurrentProfile() {
            const profileKey = this._settings.get_string('current-profile');
            const profiles = this._getAllProfiles();
            return profiles[profileKey] || profiles['grayscale'];
        }

        _applyEffectData(profile) {
            // Always clean first to ensure clean state
            this._disableEffect();

            const uiGroup = Main.uiGroup;

            // 1. Desaturation
            if (profile.factor !== undefined) {
                // Even if factor is 0, if the user requested it in preview, we apply it.
                // But optimization: factor 0 desaturate is essentially no-op,
                // unless we want to ensure chain consistency.
                if (profile.factor > 0) {
                    const effect = new Clutter.DesaturateEffect({ factor: profile.factor });
                    uiGroup.add_effect_with_name(EFFECT_DESAT, effect);
                }
            }

            // 2. Brightness / Contrast
            const b = profile.brightness || 0;
            const c = profile.contrast || 0;
            if (Math.abs(b) > 0.001 || Math.abs(c) > 0.001) {
                const bcEffect = new Clutter.BrightnessContrastEffect();
                bcEffect.set_brightness(b);
                bcEffect.set_contrast(c);
                uiGroup.add_effect_with_name(EFFECT_BC, bcEffect);
            }

            // 3. Tint - Use custom shader for proper blending
            if (profile.tint && profile.tint.a > 0) {
                const tintEffect = new TintEffect({ tint: profile.tint });
                uiGroup.add_effect_with_name(EFFECT_TINT, tintEffect);
            }
        }

        _disableEffect() {
            const uiGroup = Main.uiGroup;
            uiGroup.remove_effect_by_name(EFFECT_DESAT);
            uiGroup.remove_effect_by_name(EFFECT_BC);
            uiGroup.remove_effect_by_name(EFFECT_TINT);
        }

        destroy() {
            if (this._settingsChangedId) this._settings.disconnect(this._settingsChangedId);
            if (this._customProfilesId) this._settings.disconnect(this._customProfilesId);
            if (this._previewModeId) this._settings.disconnect(this._previewModeId);
            if (this._previewDataId) this._settings.disconnect(this._previewDataId);

            // Ensure we leave in a clean state
            this._disableEffect();
            // Reset preview flag just in case
            this._settings.set_boolean('is-previewing', false);

            super.destroy();
        }
    });

const AchromaSystemIndicator = GObject.registerClass(
    class AchromaSystemIndicator extends QuickSettings.SystemIndicator {

      constructor(extensionObject) {
          super();
          this._indicator = this._addIndicator();
          this._indicator.iconName = 'applications-graphics-symbolic';
          const toggle = new AchromaIndicator(extensionObject);
          toggle.bind_property(
              'checked',
              this._indicator,
              'visible',
              GObject.BindingFlags.SYNC_CREATE
          );
          this.quickSettingsItems.push(toggle);
      }
    });

export default class AchromaExtension extends Extension {
  enable() {
      this._indicator = new AchromaSystemIndicator(this);
      Main.panel.statusArea.quickSettings.addExternalIndicator(
          this._indicator
      );
  }

  disable() {
    this._indicator.quickSettingsItems.forEach(item => item.destroy());
    this._indicator.destroy();
  }
}
