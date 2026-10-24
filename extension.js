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
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';

import { BRIGHTNESS_LIMIT, CONTRAST_LIMIT, TINT_INTENSITY_LIMIT, loadProfiles } from './profiles.js';

const ICON_NAME = 'applications-graphics-symbolic';

// Effects are registered by name so each one can be removed without
// disturbing effects that belong to other extensions on the same actor.
const EFFECT_DESATURATE = 'chroma-effect-desat';
const EFFECT_BRIGHTNESS_CONTRAST = 'chroma-effect-bc';
const EFFECT_TINT = 'chroma-effect-tint';

// Below this a brightness/contrast change is invisible, so the effect is skipped.
const BRIGHTNESS_CONTRAST_EPSILON = 0.001;

/**
 * Blends a colour into the screen instead of overlaying it.
 *
 * Clutter has no built-in tint effect, and a plain overlay would wash out
 * blacks. Mixing in the shader keeps the original luminance. The tint is
 * premultiplied by the pixel's alpha so transparent pixels stay transparent.
 *
 * The snippet is compiled once per class and shared by every instance, so the
 * colour and intensity must be passed as uniforms. Baking them into the
 * snippet text would freeze the first values ever used, and later changes
 * (such as the intensity slider) would have no visible effect.
 */
const ChromaTintEffect = GObject.registerClass(
    class ChromaTintEffect extends Clutter.ShaderEffect {
        _init({ tint }) {
            super._init();
            this._setFloatUniform('tint_r', tint.r / 255);
            this._setFloatUniform('tint_g', tint.g / 255);
            this._setFloatUniform('tint_b', tint.b / 255);
            this._setFloatUniform('tint_amount', tint.a / 255);
        }

        _setFloatUniform(name, value) {
            const uniform = new GObject.Value();
            uniform.init(GObject.TYPE_FLOAT);
            uniform.set_float(value);
            this.set_uniform_value(name, uniform);
        }

        vfunc_get_static_snippet() {
            if (!ChromaTintEffect._snippet) {
                ChromaTintEffect._snippet = Cogl.Snippet.new(
                    Cogl.SnippetHook.FRAGMENT,
                    `uniform float tint_r;
                     uniform float tint_g;
                     uniform float tint_b;
                     uniform float tint_amount;`,
                    `cogl_color_out.rgb = mix(
                        cogl_color_out.rgb,
                        vec3(tint_r, tint_g, tint_b) * cogl_color_out.a,
                        tint_amount);`
                );
            }
            return ChromaTintEffect._snippet;
        }
    });

// The properties a live slider can change. Tint is left out because a colour
// does not fit a single slider; it is kept from whichever profile is active.
const SLIDERS = [
    { property: 'factor', title: 'Desaturation', min: 0, max: 1 },
    { property: 'brightness', title: 'Brightness', min: -BRIGHTNESS_LIMIT, max: BRIGHTNESS_LIMIT },
    { property: 'contrast', title: 'Contrast', min: -CONTRAST_LIMIT, max: CONTRAST_LIMIT },
];

const LIVE_PROFILE_NAME = 'Custom';

const ChromaToggle = GObject.registerClass(
    class ChromaToggle extends QuickSettings.QuickMenuToggle {
        _init(extensionObject) {
            super._init({
                title: 'Chroma',
                iconName: ICON_NAME,
                toggleMode: true,
            });

            this._extensionObject = extensionObject;
            this._settings = extensionObject.getSettings();
            this._profileItems = {};
            this._sliders = {};
            this._syncingSliders = false;

            // Slider adjustments live here instead of in settings: they are
            // a scratch profile that was never named or saved, so it should
            // not outlive the session or appear in preferences.
            this._liveProfile = null;

            // Always start off: a leftover effect from a previous session
            // could otherwise leave the screen altered with the toggle out of sync.
            this.checked = false;

            this.menu.setHeader(ICON_NAME, 'Chroma', null);

            this.connect('clicked', () => {
                if (this.checked)
                    this._applyActiveProfile();
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
                    // Choosing a saved profile discards any slider tweaks made
                    // on top of the previous one.
                    this._liveProfile = null;
                    this._refresh();
                }),

                this._settings.connect('changed::profiles', () => {
                    this._buildMenu();
                    this._reapplyIfActive();
                }),

                // Preferences run in a separate process from the shell, so
                // settings are the only channel for live preview.
                this._settings.connect('changed::is-previewing', () => {
                    if (this._isPreviewing()) {
                        this._applyPreviewProfile();
                        return;
                    }
                    // Preview ended: drop it and restore whatever was active before.
                    this._clearEffects();
                    this._reapplyIfActive();
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

        /**
         * Falls back to the first profile because the selected one can
         * disappear (deleted in preferences) while it is still stored as
         * current. Null only when every profile has been deleted.
         */
        _getCurrentProfile() {
            const profiles = loadProfiles(this._settings);
            const currentId = this._settings.get_string('current-profile');
            return profiles.find(profile => profile.id === currentId) ?? profiles[0] ?? null;
        }

        /**
         * What is actually on screen: the slider scratch profile if there is
         * one, otherwise the selected saved profile.
         */
        _getActiveProfile() {
            return this._liveProfile ?? this._getCurrentProfile();
        }

        // --- Menu ---

        _buildMenu() {
            this.menu.removeAll();
            this._profileItems = {};
            this._sliders = {};

            SLIDERS.forEach(spec => this.menu.addMenuItem(this._createSliderItem(spec)));
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const profiles = loadProfiles(this._settings);
            for (const profile of profiles) {
                const item = this._createProfileItem(profile);
                this._profileItems[profile.id] = item;
                this.menu.addMenuItem(item);
            }
            if (profiles.length > 0)
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._addPreferencesItem();
            this._syncMenuState();
            this._syncSliders();
        }

        _createSliderItem({ property, title, min, max }) {
            // Not activatable: clicking a row should grab the slider, not
            // close the menu.
            const item = new PopupMenu.PopupBaseMenuItem({ activate: false });

            const label = new St.Label({
                text: title,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'min-width: 6.5em;',
            });

            const slider = new Slider(0);
            slider.x_expand = true;
            slider.accessible_name = title;
            slider.connect('notify::value', () => {
                if (this._syncingSliders)
                    return;
                // Sliders run 0-1; scale back to the property's own range and
                // round so the stored values stay readable.
                const value = min + slider.value * (max - min);
                this._adjustLiveProfile(property, Math.round(value * 100) / 100);
            });

            // The row owns keyboard focus, so arrow keys must be forwarded.
            item.connect('key-press-event', (_actor, event) => slider.emit('key-press-event', event));

            item.add_child(label);
            item.add_child(slider);
            this._sliders[property] = slider;
            return item;
        }

        _createProfileItem(profile) {
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

            // The menu closes on the 'activate' signal, so the item handles
            // activation itself without emitting it. That lets the user pick
            // a profile and keep tuning the sliders without reopening the menu.
            item.activate = () => this._selectProfile(profile.id);

            return item;
        }

        _selectProfile(id) {
            // Clicking the profile that is already on screen turns it off. A
            // Custom profile does not count: clicking the saved profile then
            // should bring it back, not switch the effect off.
            const isShowing = this.checked && !this._liveProfile &&
                id === this._getCurrentProfile()?.id;
            if (isShowing) {
                this.checked = false;
                this._clearEffects();
                return;
            }

            this._liveProfile = null;
            // Picking a profile while off turns the effect on, so the
            // choice is never silently ignored.
            this.checked = true;
            this._settings.set_string('current-profile', id);
            // The setting does not change when re-picking the current
            // profile, so refresh explicitly to drop slider tweaks.
            this._refresh();
        }

        _addPreferencesItem() {
            // Closing the toggle's own submenu would leave the quick settings
            // panel open behind the preferences window, so close the panel.
            const item = this.menu.addAction('Preferences', () => {
                Main.panel.closeQuickSettings();
                this._extensionObject.openPreferences();
            });
            item.visible = Main.sessionMode.allowSettings;

            // Registering with the menu lets GNOME Shell hide the item on the
            // lock screen, where settings must not be reachable.
            this.menu._settingsActions[this._extensionObject.uuid] = item;
        }

        /**
         * The check mark shows only while a saved profile is actually on
         * screen, so it reflects what is displayed rather than just what is
         * selected. The subtitle names the active profile either way, like
         * the Wi-Fi tile does.
         */
        _syncMenuState() {
            const current = this._getCurrentProfile();
            const savedProfileShown = this.checked && !this._liveProfile;
            for (const [id, item] of Object.entries(this._profileItems))
                item._selectedIcon.visible = savedProfileShown && id === current?.id;

            this.subtitle = this._getActiveProfile()?.name ?? null;
        }

        /**
         * Moves the sliders to the active profile's values. Guarded because
         * setting a slider fires the same signal as a user drag, which would
         * otherwise turn every sync into a new scratch profile.
         */
        _syncSliders() {
            const profile = this._getActiveProfile();

            this._syncingSliders = true;
            for (const { property, min, max } of SLIDERS) {
                const value = profile?.[property] ?? 0;
                this._sliders[property].value = Math.clamp((value - min) / (max - min), 0, 1);
            }
            this._syncingSliders = false;
        }

        _refresh() {
            this._syncMenuState();
            this._syncSliders();
            this._reapplyIfActive();
        }

        // --- Effects ---

        /**
         * Starts from the active profile so tweaking one slider keeps the
         * rest, including the tint, which has no slider of its own.
         */
        _adjustLiveProfile(property, value) {
            const { id, ...base } = this._getActiveProfile() ?? {};
            this._liveProfile = { ...base, name: LIVE_PROFILE_NAME, [property]: value };

            // Adjusting while off turns the effect on, otherwise the drag
            // would appear to do nothing.
            this.checked = true;
            this._syncMenuState();
            this._reapplyIfActive();
        }

        /**
         * While previewing, the preview owns the screen; applying the active
         * profile would flicker over it.
         */
        _reapplyIfActive() {
            if (this.checked && !this._isPreviewing())
                this._applyActiveProfile();
        }

        _applyActiveProfile() {
            this._applyProfile(this._getActiveProfile());
        }

        _applyPreviewProfile() {
            try {
                const profile = JSON.parse(this._settings.get_string('preview-profile'));
                this._applyProfile(profile);
            } catch (e) {
                console.error('Chroma: Bad preview data', e);
            }
        }

        /**
         * Rebuilds the whole effect chain on every call. Effects stay attached
         * to the actor until removed, so applying only the changed ones would
         * leave stale effects behind when a profile drops a property.
         */
        _applyProfile(profile) {
            this._clearEffects();
            if (!profile)
                return;

            const uiGroup = Main.uiGroup;

            // A factor of 0 is a no-op, so skip the effect entirely.
            if (profile.factor > 0) {
                uiGroup.add_effect_with_name(
                    EFFECT_DESATURATE,
                    new Clutter.DesaturateEffect({ factor: profile.factor })
                );
            }

            // Clamped here as well as in preferences, because saved or
            // hand-edited profiles can hold values the UI would never allow.
            const brightness = Math.clamp(profile.brightness || 0, -BRIGHTNESS_LIMIT, BRIGHTNESS_LIMIT);
            const contrast = Math.clamp(profile.contrast || 0, -CONTRAST_LIMIT, CONTRAST_LIMIT);
            if (Math.abs(brightness) > BRIGHTNESS_CONTRAST_EPSILON ||
                Math.abs(contrast) > BRIGHTNESS_CONTRAST_EPSILON) {
                const effect = new Clutter.BrightnessContrastEffect();
                effect.set_brightness(brightness);
                effect.set_contrast(contrast);
                uiGroup.add_effect_with_name(EFFECT_BRIGHTNESS_CONTRAST, effect);
            }

            if (profile.tint && profile.tint.a > 0) {
                const tint = { ...profile.tint, a: Math.min(profile.tint.a, TINT_INTENSITY_LIMIT) };
                uiGroup.add_effect_with_name(EFFECT_TINT, new ChromaTintEffect({ tint }));
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
const ChromaSystemIndicator = GObject.registerClass(
    class ChromaSystemIndicator extends QuickSettings.SystemIndicator {
        constructor(extensionObject) {
            super();

            this._indicator = this._addIndicator();
            this._indicator.iconName = ICON_NAME;

            const toggle = new ChromaToggle(extensionObject);
            toggle.bind_property(
                'checked',
                this._indicator,
                'visible',
                GObject.BindingFlags.SYNC_CREATE
            );
            this.quickSettingsItems.push(toggle);
        }
    });

export default class ChromaExtension extends Extension {
    enable() {
        this._indicator = new ChromaSystemIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
    }
}
