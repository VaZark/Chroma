'use strict';

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Cogl from 'gi://Cogl';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import { DEFAULT_PROFILES } from './profiles.js';

const ICON_NAME = 'applications-graphics-symbolic';
const FALLBACK_PROFILE_ID = 'grayscale';

// Effects are registered by name so each one can be removed without
// disturbing effects that belong to other extensions on the same actor.
const EFFECT_DESATURATE = 'achroma-effect-desat';
const EFFECT_BRIGHTNESS_CONTRAST = 'achroma-effect-bc';
const EFFECT_TINT = 'achroma-effect-tint';

// Below this a brightness/contrast change is invisible, so the effect is skipped.
const BRIGHTNESS_CONTRAST_EPSILON = 0.001;

/**
 * Blends a colour into the screen instead of overlaying it.
 *
 * Clutter has no built-in tint effect, and a plain overlay would wash out
 * blacks. Mixing in the shader keeps the original luminance. The tint is
 * premultiplied by the pixel's alpha so transparent pixels stay transparent.
 */
const TintEffect = GObject.registerClass(
    class TintEffect extends Clutter.ShaderEffect {
        _init({ tint }) {
            const channel = value => (value / 255.0).toFixed(6);
            const snippet = Cogl.Snippet.new(
                Cogl.SnippetHook.FRAGMENT,
                '',
                `cogl_color_out.rgb = mix(
                    cogl_color_out.rgb,
                    vec3(${channel(tint.r)}, ${channel(tint.g)}, ${channel(tint.b)}) * cogl_color_out.a,
                    ${channel(tint.a)});`
            );
            super._init();
            this._snippet = snippet;
        }

        vfunc_get_static_snippet() {
            return this._snippet;
        }
    });

const AchromaToggle = GObject.registerClass(
    class AchromaToggle extends QuickSettings.QuickMenuToggle {
        _init(extensionObject) {
            super._init({
                title: 'Achroma',
                iconName: ICON_NAME,
                toggleMode: true,
            });

            this._extensionObject = extensionObject;
            this._settings = extensionObject.getSettings();
            this._profileItems = {};

            // Always start off: a leftover effect from a previous session
            // could otherwise leave the screen altered with the toggle out of sync.
            this.checked = false;

            this.menu.setHeader(ICON_NAME, 'Achroma', null);

            this.connect('clicked', () => {
                if (this.checked)
                    this._applyCurrentProfile();
                else
                    this._clearEffects();
            });
            this.connect('notify::checked', () => this._syncMenuState());

            this._buildMenu();
            this._connectSettings();
        }

        _connectSettings() {
            this._settingsHandlerIds = [
                this._settings.connect('changed::current-profile', () => {
                    this._syncMenuState();
                    // While previewing, the preview owns the screen; applying
                    // the saved profile would flicker over it.
                    if (this.checked && !this._isPreviewing())
                        this._applyCurrentProfile();
                }),

                this._settings.connect('changed::custom-profiles', () => this._buildMenu()),

                // Preferences run in a separate process from the shell, so
                // settings are the only channel for live preview.
                this._settings.connect('changed::is-previewing', () => {
                    if (this._isPreviewing()) {
                        this._applyPreviewProfile();
                        return;
                    }
                    // Preview ended: drop it and restore whatever was active before.
                    this._clearEffects();
                    if (this.checked)
                        this._applyCurrentProfile();
                }),

                this._settings.connect('changed::preview-profile', () => {
                    if (this._isPreviewing())
                        this._applyPreviewProfile();
                }),
            ];
        }

        _isPreviewing() {
            return this._settings.get_boolean('is-previewing');
        }

        // --- Profiles ---

        _getAllProfiles() {
            const profiles = { ...DEFAULT_PROFILES };
            try {
                const customProfiles = JSON.parse(this._settings.get_string('custom-profiles'));
                for (const profile of customProfiles) {
                    if (profile.id && profile.name)
                        profiles[profile.id] = profile;
                }
            } catch (e) {
                console.error('Achroma: Bad custom profile data', e);
            }
            return profiles;
        }

        /**
         * Falls back to grayscale because the selected profile can disappear
         * (deleted in preferences) while it is still stored as current.
         */
        _getCurrentProfile() {
            const profiles = this._getAllProfiles();
            const currentId = this._settings.get_string('current-profile');
            return profiles[currentId] || profiles[FALLBACK_PROFILE_ID];
        }

        // --- Menu ---

        _buildMenu() {
            this.menu.removeAll();
            this._profileItems = {};

            for (const [id, profile] of Object.entries(this._getAllProfiles())) {
                const item = this._createProfileItem(id, profile);
                this._profileItems[id] = item;
                this.menu.addMenuItem(item);
            }

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._addPreferencesItem();
            this._syncMenuState();
        }

        _createProfileItem(id, profile) {
            const item = new PopupMenu.PopupMenuItem(profile.name);

            // The label expands by default, which would push the check to the
            // far edge. Letting it shrink and ellipsize keeps the check
            // directly after the text and always visible, even for long names.
            item.label.x_expand = false;
            item.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            item._selectedIcon = new St.Icon({
                style_class: 'popup-menu-icon',
                icon_name: 'object-select-symbolic',
                x_align: Clutter.ActorAlign.START,
                x_expand: false,
                y_align: Clutter.ActorAlign.CENTER,
                visible: false,
            });
            item.add_child(item._selectedIcon);

            item.connect('activate', () => {
                this._settings.set_string('current-profile', id);
                // Picking a profile while off turns the effect on, so the
                // choice is never silently ignored.
                if (!this.checked) {
                    this.checked = true;
                    this._applyCurrentProfile();
                }
            });

            return item;
        }

        _addPreferencesItem() {
            const item = this.menu.addAction(
                'Preferences',
                () => this._extensionObject.openPreferences()
            );
            item.visible = Main.sessionMode.allowSettings;

            // Registering with the menu lets GNOME Shell hide the item on the
            // lock screen, where settings must not be reachable.
            this.menu._settingsActions[this._extensionObject.uuid] = item;
        }

        /**
         * The check mark shows only while the effect is on, so it reflects
         * what is on screen rather than just what is selected. The subtitle
         * shows the selection either way, like the Wi-Fi tile does.
         */
        _syncMenuState() {
            const currentId = this._settings.get_string('current-profile');
            for (const [id, item] of Object.entries(this._profileItems))
                item._selectedIcon.visible = this.checked && id === currentId;

            this.subtitle = this._getCurrentProfile()?.name ?? null;
        }

        // --- Effects ---

        _applyCurrentProfile() {
            this._applyProfile(this._getCurrentProfile());
        }

        _applyPreviewProfile() {
            try {
                const profile = JSON.parse(this._settings.get_string('preview-profile'));
                this._applyProfile(profile);
            } catch (e) {
                console.error('Achroma: Bad preview data', e);
            }
        }

        /**
         * Rebuilds the whole effect chain on every call. Effects stay attached
         * to the actor until removed, so applying only the changed ones would
         * leave stale effects behind when a profile drops a property.
         */
        _applyProfile(profile) {
            this._clearEffects();

            const uiGroup = Main.uiGroup;

            // A factor of 0 is a no-op, so skip the effect entirely.
            if (profile.factor > 0) {
                uiGroup.add_effect_with_name(
                    EFFECT_DESATURATE,
                    new Clutter.DesaturateEffect({ factor: profile.factor })
                );
            }

            const brightness = profile.brightness || 0;
            const contrast = profile.contrast || 0;
            if (Math.abs(brightness) > BRIGHTNESS_CONTRAST_EPSILON ||
                Math.abs(contrast) > BRIGHTNESS_CONTRAST_EPSILON) {
                const effect = new Clutter.BrightnessContrastEffect();
                effect.set_brightness(brightness);
                effect.set_contrast(contrast);
                uiGroup.add_effect_with_name(EFFECT_BRIGHTNESS_CONTRAST, effect);
            }

            if (profile.tint && profile.tint.a > 0) {
                uiGroup.add_effect_with_name(
                    EFFECT_TINT,
                    new TintEffect({ tint: profile.tint })
                );
            }
        }

        _clearEffects() {
            const uiGroup = Main.uiGroup;
            uiGroup.remove_effect_by_name(EFFECT_DESATURATE);
            uiGroup.remove_effect_by_name(EFFECT_BRIGHTNESS_CONTRAST);
            uiGroup.remove_effect_by_name(EFFECT_TINT);
        }

        destroy() {
            this._settingsHandlerIds.forEach(id => this._settings.disconnect(id));

            // Never leave the screen altered after the extension is gone.
            this._clearEffects();

            // The flag lives in shared settings, so a preferences window that
            // died mid-preview would otherwise leave it set for the next session.
            this._settings.set_boolean('is-previewing', false);

            super.destroy();
        }
    });

/**
 * Wraps the toggle so the panel shows an icon whenever the effect is on.
 */
const AchromaSystemIndicator = GObject.registerClass(
    class AchromaSystemIndicator extends QuickSettings.SystemIndicator {
        constructor(extensionObject) {
            super();

            this._indicator = this._addIndicator();
            this._indicator.iconName = ICON_NAME;

            const toggle = new AchromaToggle(extensionObject);
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
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
    }
}
