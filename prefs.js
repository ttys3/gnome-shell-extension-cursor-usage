import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

export default class CursorUsagePreferences extends ExtensionPreferences {
    // Helper function to create a readonly input field with label
    createReadOnlyField(label, value) {
        let entry = new Gtk.Entry({
            text: value,
            editable: false,
            can_focus: false,
            margin_top: 5,
            margin_bottom: 5,
        });
        
        let box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 5,
        });
        
        let labelWidget = new Gtk.Label({
            label: label,
            xalign: 0,
        });
        
        box.append(labelWidget);
        box.append(entry);
        
        return box;
    }

    // Helper function to create a link button
    createLinkButton(uri, label) {
        return new Gtk.LinkButton({
            uri: uri,
            label: label
        });
    }

    // Helper function to create a spin button with scroll disabled
    createSpinButton(settings, key, config) {
        let spinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: config.lower,
                upper: config.upper,
                step_increment: config.step,
                value: settings.get_int(key)
            }),
            digits: 0,
            numeric: true,
            snap_to_ticks: true
        });

        // Disable mouse wheel scrolling
        const scrollController = new Gtk.EventControllerScroll();
        scrollController.set_flags(Gtk.EventControllerScrollFlags.VERTICAL);
        scrollController.connect('scroll', () => {
            return true;
        });
        spinButton.add_controller(scrollController);

        spinButton.connect('value-changed', () => {
            settings.set_int(key, spinButton.get_value());
        });

        return spinButton;
    }

    // Helper function to create a switch option
    createSwitchOption(settings, key, label, description) {
        let box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 5
        });

        let labelWidget = new Gtk.Label({
            label: label,
            xalign: 0,
            css_classes: ['heading']
        });

        let descWidget = new Gtk.Label({
            label: description,
            xalign: 0,
            wrap: true,
            css_classes: ['caption']
        });

        let switchWidget = new Gtk.Switch({
            active: settings.get_boolean(key),
            halign: Gtk.Align.START
        });

        switchWidget.connect('notify::active', () => {
            settings.set_boolean(key, switchWidget.get_active());
        });

        box.append(labelWidget);
        box.append(descWidget);
        box.append(switchWidget);

        return box;
    }

    // Helper function to create a labeled field with description
    createLabeledField(label, description, widget) {
        let box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 5,
        });

        let labelWidget = new Gtk.Label({
            label: label,
            xalign: 0,
            css_classes: ['heading']
        });

        let descWidget = new Gtk.Label({
            label: description,
            xalign: 0,
            wrap: true,
            css_classes: ['caption']
        });

        box.append(labelWidget);
        box.append(descWidget);
        box.append(widget);

        return box;
    }

    fillPreferencesWindow(window) {
        // Set default window size
        window.set_default_size(600, 740);

        // Create a preferences page, with a single group
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Authentication'),
            description: _('Configure your Cursor account credentials for API access'),
        });
        page.add(group);

        // Create a horizontal box for buttons
        const buttonBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            margin_bottom: 10,
            halign: Gtk.Align.CENTER
        });
        group.add(buttonBox);

        // Create link buttons
        const links = [
            { uri: 'https://www.cursor.com/settings', label: 'Settings' },
            { uri: 'https://www.cursor.com/pricing', label: 'Price' },
            { uri: 'https://changelog.cursor.com/', label: 'Changelog' },
            { uri: 'https://docs.cursor.com/', label: 'Docs' },
            { uri: 'https://github.com/ttys3/gnome-shell-extension-cursor-usage/issues', label: 'Report Issue' }
        ];

        links.forEach(link => {
            buttonBox.append(this.createLinkButton(link.uri, link.label));
        });

        let settings = this.getSettings('org.gnome.shell.extensions.cursor-usage');
        let widget = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
        });

        group.add(widget);

        let cssProvider = new Gtk.CssProvider();
        cssProvider.load_from_data(`
            textview {
                background-color: #f0f0f0;
                border: 2px solid black;
                border-radius: 4px;
                padding: 4px;
            }
            textview.error {
                background-color: #ffd7d7;
                border-color: red;
            }

            entry.error {
                background-color: #ffd7d7;
                border-color: red;
            }
        `, -1);

        // Cookie input
        let cookieEntry = new Gtk.TextView({
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
            monospace: true
        });
        
        cookieEntry.get_style_context().add_provider(
            cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );
        
        let scrollWindow = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            min_content_height: 160
        });
        scrollWindow.set_child(cookieEntry);
        
        let buffer = cookieEntry.get_buffer();
        buffer.set_text(settings.get_string('cookie'), -1);
        
        buffer.connect('changed', () => {
            let [start, end] = buffer.get_bounds();
            let text = buffer.get_text(start, end, false);
            
            if (!text.startsWith('WorkosCursorSessionToken=user_')) {
                cookieEntry.add_css_class('error');
                return;
            }
            
            cookieEntry.remove_css_class('error');
            settings.set_string('cookie', text);
        });

        widget.append(this.createLabeledField(
            'API Cookie',
            'The authentication cookie from cursor.com. You can find it in browser devtools after login. The cookie should be in format: WorkosCursorSessionToken=user_id::jwt_token',
            scrollWindow
        ));

        // Monthly quota setting
        widget.append(this.createLabeledField(
            'Monthly Quota',
            'The monthly quota limit for premium model (GPT-4) usage',
            this.createSpinButton(settings, 'monthly-quota', {
                lower: 100,
                upper: 10000,
                step: 100
            })
        ));

        // Update interval setting
        widget.append(this.createLabeledField(
            'Update Interval',
            'How often to check for usage updates (in seconds)',
            this.createSpinButton(settings, 'update-interval', {
                lower: 10,
                upper: 3600,
                step: 10
            })
        ));

        // Create a horizontal box for Check for Updates and Debug mode
        let optionsBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 20,
            margin_top: 10,
            margin_bottom: 10,
            homogeneous: true
        });

        // Add switches
        optionsBox.append(this.createSwitchOption(
            settings,
            'check-update',
            'Check for Updates',
            'Automatically check for new Cursor app versions every hour'
        ));

        optionsBox.append(this.createSwitchOption(
            settings,
            'debug-mode',
            'Debug Mode',
            'Enable debug logging to system log'
        ));

        widget.append(optionsBox);

        // User info section
        let userLabel = new Gtk.Label({
            label: "User Info",
            xalign: 0,
            css_classes: ['heading']
        });
        widget.append(userLabel);

        let userInfoStr = settings.get_string('user');
        if (userInfoStr) {
            let userInfo = JSON.parse(userInfoStr);
            const fields = [
                { label: 'User ID', value: userInfo.sub || 'unknown' },
                { label: 'Email', value: userInfo.email || 'unknown' },
                { label: 'Updated At', value: userInfo.updated_at || 'unknown' }
            ];

            fields.forEach(field => {
                widget.append(this.createReadOnlyField(field.label, field.value));
            });
        }

        widget.set_visible(true);
    }
}

