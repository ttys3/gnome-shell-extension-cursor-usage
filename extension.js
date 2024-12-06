import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';


const DEFAULT_UPDATE_INTERVAL = 30; // 30 seconds in seconds

const DEFAULT_MONTHLY_QUOTA = 500;

const CursorUsageIndicator = GObject.registerClass(
class CursorUsageIndicator extends PanelMenu.Button {
    _init(uuid, settings) {
        super._init(0.0, 'Cursor Usage Indicator');
        this._extension_uuid = uuid;
        this._settings = settings;

        // Create container for label and refresh button
        let box = new St.BoxLayout();
        
        // Create the top bar label
        this.buttonText = new St.Label({
            text: 'Loading...',
            y_align: Clutter.ActorAlign.CENTER
        });
        
        // Create refresh button
        this.refreshButton = new St.Button({
            child: new St.Icon({
                icon_name: 'emblem-system-symbolic',
                style_class: 'system-status-icon',
            }),
            style_class: 'cursor-usage-refresh-button'
        });
        
        // Connect refresh button click event
        this.refreshButton.connect('clicked', () => {
            this._updateUsage();
        });
        
        // Add both elements to box
        box.add_child(this.buttonText);
        box.add_child(this.refreshButton);
        
        // Add box to the indicator
        this.add_child(box);

        // Create the popup menu
        this.menuLayout = new PopupMenu.PopupMenuSection();
        
        // Add a title item to the popup menu
        const titleItem = new PopupMenu.PopupMenuItem('Cursor Usage', { reactive: false });
        this.menuLayout.addMenuItem(titleItem);

        // add preferences button if no settings are set
        if (!this._settings.get_string('user-id') || !this._settings.get_string('cookie')) {
            this._addPreferencesButton();
        }

        this.menu.addMenuItem(this.menuLayout);

        // Initialize data
        this._usage = {};
        
        // Add settings change listeners
        this._settingsChangedId = this._connectSettingChange('update-interval', this._restartTimer.bind(this));
        this._monthlyQuotaChangedId = this._connectSettingChange('monthly-quota', this._updateUsage.bind(this));
        this._userIdChangedId = this._connectSettingChange('user-id', this._updateUsage.bind(this));
        this._cookieChangedId = this._connectSettingChange('cookie', this._updateUsage.bind(this));
        this._debugModeChangedId = this._connectSettingChange('debug-mode', () => {
            this._log('Debug mode changed to: ' + this._settings.get_boolean('debug-mode'));
        });

        // Start periodic updates
        this._updateUsage();
        this._startTimer();

        this._addCommonButtons();
    }

    _startTimer() {
        if (this._timer) {
            this._log('Removing existing timer');
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        
        let updateInterval = this._settings.get_int('update-interval');
        if (!updateInterval || updateInterval <= 0) {
            updateInterval = DEFAULT_UPDATE_INTERVAL;
        }
        
        this._log(`Creating new timer with interval: ${updateInterval} seconds`);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            updateInterval, () => {
                this._updateUsage();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _restartTimer() {
        this._startTimer();
    }

    async _updateUsage() {
        try {
            const user_id = this._settings.get_string('user-id');
            if (!user_id) {
                this._log('User ID is not set');
                return;
            }
            // Create session
            let session = new Soup.Session();
            let message = Soup.Message.new(
                'GET',
                `https://www.cursor.com/api/usage?user=${user_id}`
            );

            // Add headers
            message.request_headers.append('accept', '*/*');
            message.request_headers.append('accept-language', 'en-US,en;q=0.9');

            // Add cookie from settings
            const cookie = this._settings.get_string('cookie');
            if (!cookie) {
                this._log('Cookie is not set');
                return;
            }
            message.request_headers.append('cookie', cookie);

            // Send request
            const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            const decoder = new TextDecoder('utf-8');
            const utf8_bytes = decoder.decode(bytes.get_data());
            this._log(`Received data: ${utf8_bytes}`);
            const data = JSON.parse(utf8_bytes);

            this._usage = data;
            this._updateDisplay();
        } catch (error) {
            this._log('Error fetching Cursor usage data: ' + error);
            this.buttonText.set_text('Error');
        }
    }

    _updateDisplay() {
        this._log('Updating display');
        // Update top bar text with GPT-4 usage
        const gpt4 = this._usage['gpt-4'] || {};
        const numRequests = gpt4.numRequests || 0;
        this.buttonText.set_text(`GPT-4: ${numRequests}`);

        // Get monthly quota from settings or use default
        const monthlyQuota = this._settings.get_int('monthly-quota') || DEFAULT_MONTHLY_QUOTA;
        
        // Calculate remaining quota percentage
        const remainingPercent = Math.max(0, Math.min(100, Math.floor(((monthlyQuota - numRequests) / monthlyQuota) * 100)));
        const usedPercent = Math.max(0, Math.min(100, Math.floor((numRequests / monthlyQuota) * 100)));

        // Update icon based on remaining percentage
        let iconName;
        if (remainingPercent >= 90) {
            iconName = 'battery-level-100-symbolic';
        } else if (remainingPercent >= 80) {
            iconName = 'battery-level-90-symbolic';
        } else if (remainingPercent >= 70) {
            iconName = 'battery-level-80-symbolic';
        } else if (remainingPercent >= 60) {
            iconName = 'battery-level-70-symbolic';
        } else if (remainingPercent >= 50) {
            iconName = 'battery-level-60-symbolic';
        } else if (remainingPercent >= 40) {
            iconName = 'battery-level-50-symbolic';
        } else if (remainingPercent >= 30) {
            iconName = 'battery-level-40-symbolic';
        } else if (remainingPercent >= 20) {
            iconName = 'battery-level-30-symbolic';
        } else if (remainingPercent >= 10) {
            iconName = 'battery-low-symbolic';
        } else {
            iconName = 'battery-action-symbolic';
        }
        
        this.refreshButton.child.icon_name = iconName;


        this._log(`_updateDisplay numRequests: ${numRequests}, Used Percent: ${usedPercent}, Remaining Percent: ${remainingPercent}, Monthly Quota: ${monthlyQuota}, Icon: ${iconName}`);

        this._log('menu removeAll');
        // Clear existing menu items
        this.menuLayout.removeAll();

        const titleItem = new PopupMenu.PopupMenuItem('Cursor Usage', { reactive: false });
        this.menuLayout.addMenuItem(titleItem);

        // add monthly usage percentage
        const monthlyUsage = new PopupMenu.PopupMenuItem('', { reactive: false });
        monthlyUsage.label.text = `Used Percentage: ${usedPercent}% (${numRequests}/${monthlyQuota})`;
        this.menuLayout.addMenuItem(monthlyUsage);

        // Add menu items for each model
        for (const [model, data] of Object.entries(this._usage)) {
            // add a separator
            this.menuLayout.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const menuItem = new PopupMenu.PopupMenuItem('');
            let box = new St.BoxLayout({ vertical: true });

            let modelLabel = new St.Label({ text: model, style: 'font-weight: bold;' });
            box.add_child(modelLabel);

            // Create boxes for each stat (horizontal layout by default)
            let requestsBox = new St.BoxLayout();
            let tokensBox = new St.BoxLayout();

            // Create labels with fixed width for the keys
            let requestsKeyLabel = new St.Label({ 
                text: 'Requests: ',
                style: 'min-width: 70px;' // Adjust width as needed
            });
            let tokensKeyLabel = new St.Label({ 
                text: 'Tokens: ',
                style: 'min-width: 70px;' // Adjust width as needed
            });

            // Create labels for the values
            let requestsValueLabel = new St.Label({ text: `${data.numRequests}` });
            let tokensValueLabel = new St.Label({ text: `${data.numTokens}` });

            // Add labels to their respective boxes
            requestsBox.add_child(requestsKeyLabel);
            requestsBox.add_child(requestsValueLabel);
            tokensBox.add_child(tokensKeyLabel);
            tokensBox.add_child(tokensValueLabel);

            // Add the horizontal boxes to the main vertical box
            box.add_child(requestsBox);
            box.add_child(tokensBox);

            menuItem.add_child(box);
            this.menuLayout.addMenuItem(menuItem);

            // Add click event to copy text to clipboard
            menuItem.connect('activate', () => {
                // Build a text string with all the information
                const copyText = `Model: ${model}\nRequests: ${data.numRequests}\nTokens: ${data.numTokens}`;
                // Log the copied text
                this._log(`Copied to clipboard: ${copyText}`);
                // Copy text to clipboard
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, copyText);
            });
        }

        this._log('addCommonButtons');
        this._addCommonButtons();
    }

    destroy() {
        if (this._timer) {
            this._log('Cleaning up timer on destroy');
            GLib.source_remove(this._timer);
        }
        // Disconnect settings signal
        if (this._settingsChangedId) {
            this._log('Disconnecting settings signal');
            this._settings.disconnect(this._settingsChangedId);
        }
        // Disconnect monthly-quota settings signal
        if (this._monthlyQuotaChangedId) {
            this._log('Disconnecting monthly-quota settings signal');
            this._settings.disconnect(this._monthlyQuotaChangedId);
        }
        // Disconnect user-id settings signal
        if (this._userIdChangedId) {
            this._log('Disconnecting user-id settings signal');
            this._settings.disconnect(this._userIdChangedId);
        }
        // Disconnect cookie settings signal
        if (this._cookieChangedId) {
            this._log('Disconnecting cookie settings signal');
            this._settings.disconnect(this._cookieChangedId);
        }
        // Disconnect debug-mode settings signal
        if (this._debugModeChangedId) {
            this._log('Disconnecting debug-mode settings signal');
            this._settings.disconnect(this._debugModeChangedId);
        }
        super.destroy();
    }

    _connectSettingChange(settingKey, callback) {
        // Connect setting change signal and return the signal ID
        return this._settings.connect(`changed::${settingKey}`, callback);
    }

    _addPreferencesButton() {
        const preferencesButton = new PopupMenu.PopupMenuItem(_('Preferences'), { reactive: true });
        preferencesButton.connect('activate', () => {
            this.menu.close();
            Util.spawn(["gnome-extensions", "prefs", this._extension_uuid]);
        });
        this.menuLayout.addMenuItem(preferencesButton);
    }

    _addCommonButtons() {
        // add a separator
        this.menuLayout.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // add a refresh button
        const refreshButton = new PopupMenu.PopupMenuItem('Refresh', { reactive: true });
        refreshButton.connect('activate', () => {
            this.menu.close();
            this._updateUsage();
        });
        this.menuLayout.addMenuItem(refreshButton);

        // add a separator
        this.menuLayout.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addPreferencesButton();
    }

    _log(message) {
        if (this._settings.get_boolean('debug-mode')) {
            const now = new Date();
            // Get timezone offset in minutes
            const tzOffset = -now.getTimezoneOffset();
            const tzHours = String(Math.abs(Math.floor(tzOffset / 60))).padStart(2, '0');
            const tzMinutes = String(Math.abs(tzOffset % 60)).padStart(2, '0');
            const tzSign = tzOffset >= 0 ? '+' : '-';
            
            // Format datetime in RFC3339 with local timezone
            const timestamp = now.getFullYear() +
                '-' + String(now.getMonth() + 1).padStart(2, '0') +
                '-' + String(now.getDate()).padStart(2, '0') +
                'T' + String(now.getHours()).padStart(2, '0') +
                ':' + String(now.getMinutes()).padStart(2, '0') +
                ':' + String(now.getSeconds()).padStart(2, '0') +
                tzSign + tzHours + ':' + tzMinutes;
                
            log(`[Cursor Usage] [${timestamp}] ${message}`);
        }
    }
});

export default class CursorUsageExtension extends Extension {
    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.cursor-usage');
        this._indicator = new CursorUsageIndicator(this.uuid, this._settings);
        Main.panel.addToStatusArea('cursor-usage', this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }
} 