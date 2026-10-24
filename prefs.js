'use strict';

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    BRIGHTNESS_LIMIT,
    CONTRAST_LIMIT,
    TINT_INTENSITY_LIMIT,
    loadProfiles,
    saveProfiles,
} from './profiles.js';

// Slider drags fire many events per second and every preview update is a
// settings write the shell must react to, so updates are batched.
const PREVIEW_THROTTLE_MS = 30;

const DEFAULT_TINT_COLOR = 'rgba(255, 220, 180, 1)';
const DEFAULT_TINT_INTENSITY = 40;

export default class AchromaPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // A preferences window that crashed mid-preview leaves the flag set,
        // which would keep the shell showing a stale preview.
        settings.set_boolean('is-previewing', false);

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const profilesGroup = new Adw.PreferencesGroup({
            title: 'Profiles',
            description: 'Create, edit or remove display effects',
        });
        page.add(profilesGroup);

        const selectionGroup = new Adw.PreferencesGroup({
            title: 'Active Profile',
            description: 'Select the profile to apply',
        });
        page.add(selectionGroup);

        const comboRow = new Adw.ComboRow({ title: 'Current Profile' });
        selectionGroup.add(comboRow);

        const refreshProfiles = () => {
            this._populateProfileRows(window, settings, profilesGroup, refreshProfiles);
            this._populateProfileCombo(settings, comboRow);
        };
        refreshProfiles();

        comboRow.connect('notify::selected', () => {
            // Repopulating resets the selection, which must not be mistaken
            // for the user picking the first profile.
            if (comboRow._populating)
                return;
            const id = comboRow._profileIds[comboRow.get_selected()];
            if (id)
                settings.set_string('current-profile', id);
        });
    }

    // --- Profile list ---

    /**
     * Rows are tracked on the group because Adw.PreferencesGroup offers no
     * way to clear its children, so stale rows must be removed individually
     * before the list is rebuilt.
     */
    _populateProfileRows(window, settings, group, onChange) {
        (group._achromaRows ?? []).forEach(row => group.remove(row));
        group._achromaRows = [];

        const addRow = row => {
            group.add(row);
            group._achromaRows.push(row);
        };

        loadProfiles(settings).forEach(profile => {
            addRow(this._createProfileRow(window, settings, profile, onChange));
        });
        addRow(this._createNewProfileRow(window, settings, onChange));
    }

    _createProfileRow(window, settings, profile, onChange) {
        const row = new Adw.ActionRow({ title: profile.name });

        const editButton = new Gtk.Button({
            icon_name: 'document-edit-symbolic',
            valign: Gtk.Align.CENTER,
        });
        editButton.add_css_class('flat');
        editButton.connect('clicked', () => this._openProfileEditor(window, settings, profile, onChange));
        row.add_suffix(editButton);

        const deleteButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
        });
        deleteButton.add_css_class('destructive-action');
        deleteButton.connect('clicked', () => {
            // Re-read instead of reusing the list captured at build time, which
            // may be stale if another change happened since the rows were drawn.
            saveProfiles(settings, loadProfiles(settings).filter(p => p.id !== profile.id));
            onChange();
        });
        row.add_suffix(deleteButton);

        return row;
    }

    _createNewProfileRow(window, settings, onChange) {
        const row = new Adw.ActionRow({
            title: 'Create New Profile',
            subtitle: 'Configure brightness, contrast, and color',
            activatable: true,
        });
        row.add_prefix(new Gtk.Image({ icon_name: 'list-add-symbolic' }));
        row.connect('activated', () => this._openProfileEditor(window, settings, null, onChange));
        return row;
    }

    _populateProfileCombo(settings, comboRow) {
        const profiles = loadProfiles(settings);
        const currentId = settings.get_string('current-profile');

        // The model shows names, but selection is by id, so the two are kept
        // in step through a parallel list.
        comboRow._profileIds = profiles.map(profile => profile.id);

        comboRow._populating = true;
        comboRow.set_model(Gtk.StringList.new(profiles.map(profile => profile.name)));

        // Fall back to the first entry when the stored profile no longer
        // exists, so the combo never shows an empty selection.
        comboRow.set_selected(Math.max(0, comboRow._profileIds.indexOf(currentId)));
        comboRow._populating = false;
    }

    // --- Profile editor dialog ---

    /**
     * Live preview works by flipping `is-previewing` and streaming the draft
     * profile through settings, which the shell extension watches. The flag
     * must be cleared on every exit path, otherwise the shell keeps showing
     * the draft instead of the saved profile.
     */
    _openProfileEditor(parentWindow, settings, existingProfile, onSaved) {
        settings.set_boolean('is-previewing', true);

        try {
            const dialog = new Gtk.Window({
                transient_for: parentWindow,
                modal: true,
                title: existingProfile ? 'Edit Profile' : 'Create Profile',
                default_width: 450,
                default_height: 600,
                resizable: false,
            });
            dialog.connect('close-request', () => {
                settings.set_boolean('is-previewing', false);
                return false;
            });

            const controls = this._buildProfileControls(existingProfile ?? {});
            const pushPreview = this._createThrottledPreview(settings, controls);

            this._connectPreviewListeners(controls, pushPreview);

            const actionBar = this._buildActionBar(dialog, settings, controls, existingProfile, onSaved);
            const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
            root.append(this._wrapInScroller(controls.container));
            root.append(actionBar);
            dialog.set_child(root);

            pushPreview();
            dialog.present();
        } catch (e) {
            // If building the UI fails the dialog (and its close handler)
            // never exists, so reset here or the preview would be stuck on.
            console.error('Achroma Preferences Error:', e);
            settings.set_boolean('is-previewing', false);
        }
    }

    _wrapInScroller(child) {
        const scrolled = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vexpand: true,
        });
        scrolled.set_child(child);
        return scrolled;
    }

    _createSliderRow(title, { min, max, step, value }) {
        const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, min, max, step);
        scale.set_value(value);
        scale.set_hexpand(true);

        const row = new Adw.ActionRow({ title });
        row.add_suffix(scale);
        return { row, scale };
    }

    _buildProfileControls(initial) {
        const container = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
        });

        const nameGroup = new Adw.PreferencesGroup();
        const nameEntry = new Adw.EntryRow({ title: 'Profile Name', text: initial.name ?? '' });
        nameGroup.add(nameEntry);
        container.append(nameGroup);

        const saturationGroup = new Adw.PreferencesGroup({ title: 'Saturation' });
        const saturation = this._createSliderRow('Desaturation Level', { min: 0, max: 1, step: 0.05, value: initial.factor ?? 1 });
        saturationGroup.add(saturation.row);
        container.append(saturationGroup);

        const exposureGroup = new Adw.PreferencesGroup({ title: 'Exposure' });
        const brightness = this._createSliderRow('Brightness', { min: -BRIGHTNESS_LIMIT, max: BRIGHTNESS_LIMIT, step: 0.05, value: initial.brightness ?? 0 });
        const contrast = this._createSliderRow('Contrast', { min: -CONTRAST_LIMIT, max: CONTRAST_LIMIT, step: 0.05, value: initial.contrast ?? 0 });
        exposureGroup.add(brightness.row);
        exposureGroup.add(contrast.row);
        container.append(exposureGroup);

        const tintGroup = new Adw.PreferencesGroup({ title: 'Color Tint' });
        const tintSwitch = new Adw.SwitchRow({ title: 'Enable Color Tint', active: Boolean(initial.tint) });
        const tintColor = this._createTintColorRow(initial.tint);
        const tintIntensity = this._createSliderRow('Tint Intensity', {
            min: 0, max: TINT_INTENSITY_LIMIT, step: 5, value: initial.tint?.a ?? DEFAULT_TINT_INTENSITY,
        });
        tintGroup.add(tintSwitch);
        tintGroup.add(tintColor.row);
        tintGroup.add(tintIntensity.row);
        container.append(tintGroup);

        // The tint options mean nothing while the tint is off, so they are
        // disabled rather than hidden to keep the layout stable.
        const syncTintSensitivity = () => {
            const enabled = tintSwitch.get_active();
            tintColor.row.set_sensitive(enabled);
            tintIntensity.row.set_sensitive(enabled);
        };
        tintSwitch.connect('notify::active', syncTintSensitivity);
        syncTintSensitivity();

        return {
            container,
            nameEntry,
            saturationScale: saturation.scale,
            brightnessScale: brightness.scale,
            contrastScale: contrast.scale,
            tintSwitch,
            tintButton: tintColor.button,
            tintIntensityScale: tintIntensity.scale,
        };
    }

    _createTintColorRow(tint) {
        const rgba = new Gdk.RGBA();
        if (tint) {
            rgba.red = tint.r / 255;
            rgba.green = tint.g / 255;
            rgba.blue = tint.b / 255;
            rgba.alpha = 1;
        } else {
            rgba.parse(DEFAULT_TINT_COLOR);
        }

        const button = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({ with_alpha: true }),
            rgba,
        });
        button.set_valign(Gtk.Align.CENTER);

        const row = new Adw.ActionRow({ title: 'Tint Color' });
        row.add_suffix(button);
        return { row, button };
    }

    /**
     * Reads the current control values in the same shape the extension
     * expects, so one object serves both live preview and saving.
     */
    _readProfile(controls) {
        let tint = null;
        if (controls.tintSwitch.get_active()) {
            const color = controls.tintButton.get_rgba();
            tint = {
                r: Math.round(color.red * 255),
                g: Math.round(color.green * 255),
                b: Math.round(color.blue * 255),
                a: controls.tintIntensityScale.get_value(),
            };
        }
        return {
            factor: controls.saturationScale.get_value(),
            brightness: controls.brightnessScale.get_value(),
            contrast: controls.contrastScale.get_value(),
            tint,
        };
    }

    _createThrottledPreview(settings, controls) {
        let pendingSourceId = 0;

        return () => {
            if (pendingSourceId > 0)
                return;

            pendingSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PREVIEW_THROTTLE_MS, () => {
                settings.set_string('preview-profile', JSON.stringify(this._readProfile(controls)));
                pendingSourceId = 0;
                return GLib.SOURCE_REMOVE;
            });
        };
    }

    _connectPreviewListeners(controls, pushPreview) {
        controls.saturationScale.connect('value-changed', pushPreview);
        controls.brightnessScale.connect('value-changed', pushPreview);
        controls.contrastScale.connect('value-changed', pushPreview);
        controls.tintIntensityScale.connect('value-changed', pushPreview);
        controls.tintButton.connect('notify::rgba', pushPreview);
        controls.tintSwitch.connect('notify::active', pushPreview);
    }

    _buildActionBar(dialog, settings, controls, existingProfile, onSaved) {
        const actionBar = new Gtk.ActionBar();

        const cancelButton = new Gtk.Button({ label: 'Cancel' });
        cancelButton.connect('clicked', () => dialog.close());
        actionBar.pack_start(cancelButton);

        // An unnamed profile would be unselectable in the menu, so saving
        // stays disabled until a name is entered.
        const saveButton = new Gtk.Button({ label: 'Save Profile' });
        saveButton.add_css_class('suggested-action');
        saveButton.set_sensitive(controls.nameEntry.get_text().length > 0);
        controls.nameEntry.connect('notify::text', () => {
            saveButton.set_sensitive(controls.nameEntry.get_text().length > 0);
        });

        saveButton.connect('clicked', () => {
            const name = controls.nameEntry.get_text();
            if (!name)
                return;

            const profile = {
                id: existingProfile?.id ?? this._generateProfileId(),
                name,
                ...this._readProfile(controls),
            };

            // Re-read so edits made elsewhere while the dialog was open
            // are not overwritten by a stale copy.
            const profiles = loadProfiles(settings);
            const index = profiles.findIndex(p => p.id === profile.id);
            if (index >= 0)
                profiles[index] = profile;
            else
                profiles.push(profile);
            saveProfiles(settings, profiles);

            // destroy() bypasses the close-request handler that normally clears
            // the flag, so it has to be cleared here.
            settings.set_boolean('is-previewing', false);
            onSaved();
            dialog.destroy();
        });
        actionBar.pack_end(saveButton);

        return actionBar;
    }

    /**
     * Random rather than derived from the name so renaming or duplicate names
     * can never make two profiles collide.
     */
    _generateProfileId() {
        return `custom-${Math.random().toString(36).slice(2, 11)}`;
    }
}
