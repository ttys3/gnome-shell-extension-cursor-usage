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

        this.menu.addMenuItem(this.menuLayout);

        // Initialize data
        this._usage = {};
        
        // Add settings change listener
        this._settingsChangedId = this._settings.connect('changed::update-interval', () => {
            this._restartTimer();
        });

        // Add settings change listener for monthly-quota
        this._monthlyQuotaChangedId = this._settings.connect('changed::monthly-quota', () => {
            this._updateUsage();
        });

        // Start periodic updates
        this._updateUsage();
        this._startTimer();
    }

    _startTimer() {
        // Clear existing timer if any
        if (this._timer) {
            log('[Cursor Usage] Removing existing timer');
            GLib.source_remove(this._timer);
            this._timer = null;
        }

        // Get update interval from settings, fallback to default if not set or invalid
        let updateInterval = this._settings.get_int('update-interval');
        if (!updateInterval || updateInterval <= 0) {
            updateInterval = DEFAULT_UPDATE_INTERVAL;
        }
        
        log(`[Cursor Usage] Creating new timer with interval: ${updateInterval} seconds`);
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
                log('User ID is not set');
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
                log('Cookie is not set');
                return;
            }
            message.request_headers.append('cookie', cookie);

            // Send request
            const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            const decoder = new TextDecoder('utf-8');
            const data = JSON.parse(decoder.decode(bytes.get_data()));

            this._usage = data;
            this._updateDisplay();
        } catch (error) {
            log('Error fetching Cursor usage data: ' + error);
            this.buttonText.set_text('Error');
        }
    }

    _updateDisplay() {
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

        // Clear existing menu items except the first one
        // this.menuLayout.removeAll();
        while (this.menuLayout.numMenuItems > 1) {
            this.menuLayout._getMenuItems()[1].destroy();
        }

        // add a separator
        this.menuLayout.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // add monthly usage percentage
        const monthlyUsage = new PopupMenu.PopupMenuItem('', { reactive: false });
        monthlyUsage.label.text = `Used Percentage: ${usedPercent}% (${numRequests}/${monthlyQuota})`;
        this.menuLayout.addMenuItem(monthlyUsage);

        // Add menu items for each model
        for (const [model, data] of Object.entries(this._usage)) {
            // add a separator
            this.menuLayout.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const menuItem = new PopupMenu.PopupMenuItem('');
            menuItem.label.text = `${model}:\nRequests: ${data.numRequests}\nTokens: ${data.numTokens}`;
            this.menuLayout.addMenuItem(menuItem);
        }


        // add a separator
        this.menuLayout.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // add a settings button
        const settingsButton = new PopupMenu.PopupMenuItem('Settings', { reactive: true });
        settingsButton.connect('activate', () => {
            this.menu.close();
            Util.spawn(["gnome-extensions", "prefs", this._extension_uuid]);
        });
        this.menuLayout.addMenuItem(settingsButton);
    }

    destroy() {
        if (this._timer) {
            log('[Cursor Usage] Cleaning up timer on destroy');
            GLib.source_remove(this._timer);
        }
        // Disconnect settings signal
        if (this._settingsChangedId) {
            log('[Cursor Usage] Disconnecting settings signal');
            this._settings.disconnect(this._settingsChangedId);
        }
        // Disconnect monthly-quota settings signal
        if (this._monthlyQuotaChangedId) {
            log('[Cursor Usage] Disconnecting monthly-quota settings signal');
            this._settings.disconnect(this._monthlyQuotaChangedId);
        }
        super.destroy();
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