import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

export default class CursorUsagePreferences extends ExtensionPreferences {
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
            spacing: 10,  // Add some spacing between buttons
            margin_bottom: 10,
            halign: Gtk.Align.CENTER  // Center the buttons horizontally
        });
        group.add(buttonBox);

        const linkButtonSettingsPage = new Gtk.LinkButton({
            uri: 'https://www.cursor.com/settings',
            label: 'Settings'
        });
        buttonBox.append(linkButtonSettingsPage);

        const linkButtonPricePage = new Gtk.LinkButton({
            uri: 'https://www.cursor.com/pricing',
            label: 'Price'
        });
        buttonBox.append(linkButtonPricePage);

        const linkButtonChangelog = new Gtk.LinkButton({
            uri: 'https://changelog.cursor.com/',
            label: 'Changelog'
        });
        buttonBox.append(linkButtonChangelog);

        const linkButtonDocs = new Gtk.LinkButton({
            uri: 'https://docs.cursor.com/',
            label: 'Docs'
        });
        buttonBox.append(linkButtonDocs);
        const linkButtonIssue = new Gtk.LinkButton({
            uri: 'https://github.com/ttys3/gnome-shell-extension-cursor-usage/issues',
            label: 'Report Issue'
        });
        buttonBox.append(linkButtonIssue);

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
        

        // cookie 
        let cookieLabel = new Gtk.Label({
            label: "API Cookie",
            xalign: 0,
            css_classes: ['heading']
        });

        // Add description label for cookie
        let cookieDesc = new Gtk.Label({
            label: "The authentication cookie from cursor.com. You can find it in browser devtools after login. The cookie should be in format: WorkosCursorSessionToken=user_id::jwt_token",
            xalign: 0,
            wrap: true,
            css_classes: ['caption']
        });
    
        let cookieEntry = new Gtk.TextView({
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
            monospace: true
        });
        
        // Add CSS styling to TextView
        cookieEntry.get_style_context().add_provider(
            cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );
        
        // Create a scroll window to contain the TextView
        let scrollWindow = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            min_content_height: 160
        });
        scrollWindow.set_child(cookieEntry);
        
        // Get and set the buffer text
        let buffer = cookieEntry.get_buffer();
        buffer.set_text(settings.get_string('cookie'), -1);
        
        buffer.connect('changed', () => {
            let [start, end] = buffer.get_bounds();
            let text = buffer.get_text(start, end, false);
            
            // Validate cookie format
            if (!text.startsWith('WorkosCursorSessionToken=user_')) {
                // Add error style to TextView
                cookieEntry.add_css_class('error');
                // Don't save invalid value
                return;
            }
            
            // Remove error style if value is valid
            cookieEntry.remove_css_class('error');
            settings.set_string('cookie', text);
        });
        
        widget.append(cookieLabel);
        widget.append(cookieDesc);
        widget.append(scrollWindow);

        // Monthly quota setting
        let quotaLabel = new Gtk.Label({
            label: "Monthly Quota",
            xalign: 0,
            css_classes: ['heading']
        });

        let quotaDesc = new Gtk.Label({
            label: "The monthly quota limit for premium model (GPT-4) usage",
            xalign: 0,
            wrap: true,
            css_classes: ['caption']
        });

        let quotaSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 100,
                upper: 10000,
                step_increment: 100,
                value: settings.get_int('monthly-quota')
            }),
            digits: 0,
            numeric: true,
            snap_to_ticks: true
        });

        // Disable mouse wheel scrolling
        const scrollController = new Gtk.EventControllerScroll();
        scrollController.set_flags(Gtk.EventControllerScrollFlags.VERTICAL);
        scrollController.connect('scroll', () => {
            return true; // Prevent default scroll behavior
        });
        quotaSpinButton.add_controller(scrollController);

        quotaSpinButton.connect('value-changed', () => {
            settings.set_int('monthly-quota', quotaSpinButton.get_value());
        });

        widget.append(quotaLabel);
        widget.append(quotaDesc); 
        widget.append(quotaSpinButton);

        // Update interval setting
        let updateIntervalLabel = new Gtk.Label({
            label: "Update Interval",
            xalign: 0,
            css_classes: ['heading']
        });

        // Add description for update interval
        let updateIntervalDesc = new Gtk.Label({
            label: "How often to check for usage updates (in seconds)",
            xalign: 0,
            wrap: true,
            css_classes: ['caption']
        });

        let updateIntervalSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 10,       
                upper: 3600,   
                step_increment: 10,
                value: settings.get_int('update-interval')
            }),
            digits: 0,
            numeric: true,
            snap_to_ticks: true
        });

        // Disable mouse wheel scrolling
        const scrollController2 = new Gtk.EventControllerScroll();
        scrollController2.set_flags(Gtk.EventControllerScrollFlags.VERTICAL);
        scrollController2.connect('scroll', () => {
            return true; // Prevent default scroll behavior
        });
        updateIntervalSpinButton.add_controller(scrollController2);

        updateIntervalSpinButton.connect('value-changed', () => {
            settings.set_int('update-interval', updateIntervalSpinButton.get_value());
        });

        widget.append(updateIntervalLabel);
        widget.append(updateIntervalDesc);
        widget.append(updateIntervalSpinButton);

        // Create a horizontal box for Check for Updates and Debug mode
        let optionsBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 20,  // Add some spacing between options
            margin_top: 10,
            margin_bottom: 10,
            homogeneous: true  // Make both options take equal space
        });

        // Check for Updates - vertical box for label and switch
        let checkUpdateBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 5
        });

        let checkUpdateLabel = new Gtk.Label({
            label: "Check for Updates",
            xalign: 0,
            css_classes: ['heading']
        });

        let checkUpdateDesc = new Gtk.Label({
            label: "Automatically check for new Cursor app versions every hour",
            xalign: 0,
            wrap: true,
            css_classes: ['caption']
        });

        let checkUpdateSwitch = new Gtk.Switch({
            active: settings.get_boolean('check-update'),
            halign: Gtk.Align.START
        });

        checkUpdateSwitch.connect('notify::active', () => {
            settings.set_boolean('check-update', checkUpdateSwitch.get_active());
        });

        checkUpdateBox.append(checkUpdateLabel);
        checkUpdateBox.append(checkUpdateDesc);
        checkUpdateBox.append(checkUpdateSwitch);

        // Debug mode - vertical box for label and switch
        let debugModeBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 5
        });

        let debugModeLabel = new Gtk.Label({
            label: "Debug Mode",
            xalign: 0,
            css_classes: ['heading']
        });

        let debugModeDesc = new Gtk.Label({
            label: "Enable debug logging to system log",
            xalign: 0,
            wrap: true,
            css_classes: ['caption']
        });

        let debugModeSwitch = new Gtk.Switch({
            active: settings.get_boolean('debug-mode'),
            halign: Gtk.Align.START
        });

        debugModeSwitch.connect('notify::active', () => {
            settings.set_boolean('debug-mode', debugModeSwitch.get_active());
        });

        debugModeBox.append(debugModeLabel);
        debugModeBox.append(debugModeDesc);
        debugModeBox.append(debugModeSwitch);

        // Add both option boxes to the horizontal box
        optionsBox.append(checkUpdateBox);
        optionsBox.append(debugModeBox);

        // Add the horizontal box to the main widget
        widget.append(optionsBox);

        // show user info
        let userLabel = new Gtk.Label({
            label: "User Info",
            xalign: 0,
            css_classes: ['heading']
        });
        widget.append(userLabel);

        // get user info from settings
        let userInfoStr = settings.get_string('user');
        if (userInfoStr) {
            let userInfo = JSON.parse(userInfoStr);

            // User ID readonly input
            let user_sub = userInfo.sub || 'unknown';
            let userIdEntry = new Gtk.Entry({
                text: user_sub,
                editable: false,
                can_focus: false,
                margin_top: 5,
                margin_bottom: 5,
            });
            let userIdBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 5,
            });
            let userIdLabel = new Gtk.Label({
                label: "User ID",
                xalign: 0,
            });
            userIdBox.append(userIdLabel);
            userIdBox.append(userIdEntry);
            widget.append(userIdBox);

            // Email readonly input
            let user_email = userInfo.email || 'unknown';
            let emailEntry = new Gtk.Entry({
                text: user_email,
                editable: false,
                can_focus: false,
                margin_top: 5,
                margin_bottom: 5,
            });
            let emailBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 5,
            });
            let emailLabel = new Gtk.Label({
                label: "Email",
                xalign: 0,
            });
            emailBox.append(emailLabel);
            emailBox.append(emailEntry);
            widget.append(emailBox);

            // Updated At readonly input
            let user_updated_at = userInfo.updated_at || 'unknown';
            let updatedAtEntry = new Gtk.Entry({
                text: user_updated_at,
                editable: false,
                can_focus: false,
                margin_top: 5,
                margin_bottom: 5,
            });
            let updatedAtBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 5,
            });
            let updatedAtLabel = new Gtk.Label({
                label: "Updated At",
                xalign: 0,
            });
            updatedAtBox.append(updatedAtLabel);
            updatedAtBox.append(updatedAtEntry);
            widget.append(updatedAtBox);
        }

        widget.set_visible(true);
    }
}

