import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const DEFAULT_UPDATE_INTERVAL = 30; // 30 seconds in seconds
const DEFAULT_MONTHLY_QUOTA = 500;
const UPDATE_CHECK_INTERVAL = 1800; // 30 minutes in seconds

// Async spawn function to avoid blocking the UI thread
function spawnCommandAsync(commandLine) {
    return new Promise((resolve, reject) => {
        try {
            // Parse command line into array
            let [success, argv] = GLib.shell_parse_argv(commandLine);
            if (!success) {
                reject(new Error(`Failed to parse command: ${commandLine}`));
                return;
            }

            // Create subprocess
            let proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);

            // Communicate async
            proc.communicate_utf8_async(null, null, (proc, result) => {
                try {
                    let [success, stdout, stderr] = proc.communicate_utf8_finish(result);
                    let exitStatus = proc.get_exit_status();
                    
                    resolve({
                        success: success && exitStatus === 0,
                        stdout: stdout || '',
                        stderr: stderr || '',
                        exitStatus: exitStatus
                    });
                } catch (error) {
                    reject(error);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

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
        if (!this._settings.get_string('cookie')) {
            this._addPreferencesButton();
        }

        this.menu.addMenuItem(this.menuLayout);

        // Initialize data
        this._usage = {};
        
        // Add settings change listeners
        this._settingsChangedId = this._connectSettingChange('update-interval', this._restartTimer.bind(this));
        this._monthlyQuotaChangedId = this._connectSettingChange('monthly-quota', this._updateUsage.bind(this));
        this._userIdChangedId = this._connectSettingChange('user-id', this._updateUsage.bind(this));
        this._cookieChangedId = this._connectSettingChange('cookie', () => {
            this._updateUsage();
            this._updateUserInfo();
        });
        this._debugModeChangedId = this._connectSettingChange('debug-mode', () => {
            this._log('Debug mode changed to: ' + this._settings.get_boolean('debug-mode'));
        });
        this._checkUpdateChangedId = this._connectSettingChange('check-update', this._restartUpdateTimer.bind(this));
        // Add trigger-check-update listener
        this._triggerCheckUpdateChangedId = this._connectSettingChange('trigger-check-update', () => {
            if (this._settings.get_boolean('trigger-check-update')) {
                // Reset the trigger
                this._settings.set_boolean('trigger-check-update', false);
                this._checkForUpdates();
            }
        });

        // Start periodic updates
        this._updateUsage();
        this._startTimer();
        this._startUpdateTimer();

        this._addCommonButtons();

        // update user info if empty
        this._updateUserInfo();

        // Add a property to store the last notification
        this._lastNotification = null;
        this._notifiedVersion = null;
        this._currentNotificationDestroyHandlerId = 0;
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

    _startUpdateTimer() {
        if (this._updateTimer) {
            this._log('Removing existing update timer');
            GLib.source_remove(this._updateTimer);
            this._updateTimer = null;
        }

        if (!this._settings.get_boolean('check-update')) {
            this._log('Update checking is disabled');
            return;
        }

        this._log('Creating new update timer');
        this._updateTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            UPDATE_CHECK_INTERVAL, () => {
                this._checkForUpdates();
                return GLib.SOURCE_CONTINUE;
            });

        // Check for updates immediately
        this._checkForUpdates();
        this._log('Update timer started');
    }

    _restartUpdateTimer() {
        this._startUpdateTimer();
    }

    async _getLocalVersion() {
        try {
            let result = await spawnCommandAsync('cursor --version');
            if (!result.success) {
                this._log('Failed to get local version: ' + result.stderr);
                return null;
            }
            let version = result.stdout.split('\n')[0].trim();
            this._log('Local version: ' + version);
            return version;
        } catch (error) {
            this._log('Error getting local version: ' + error);
            // Get PATH environment variable for debugging
            const path = GLib.getenv('PATH');
            if (!path) {
                this._log('PATH environment variable not found');
                return 'Error';
            } else {
                this._log('PATH environment variable found: ' + path);
            }
            return null;
        }
    }

    async _getMachineHash() {
        try {
            let result = await spawnCommandAsync('cat /etc/machine-id');
            if (!result.success) {
                this._log('Failed to get machine ID: ' + result.stderr);
                return null;
            }
            const machineId = result.stdout.trim();
            if (!machineId) {
                this._log('Machine ID is empty');
                return null;
            }
            
            // Generate SHA256 hash from machine ID
            result = await spawnCommandAsync(`echo -n '${machineId}' | sha256sum | cut -d' ' -f1`);
            if (!result.success) {
                this._log('Failed to generate hash: ' + result.stderr);
                return null;
            }
            
            const hash = result.stdout.trim();
            this._log('Generated machine hash: ' + hash);
            return hash;
        } catch (error) {
            this._log('Error getting machine hash: ' + error);
            return null;
        }
    }

    _detectPlatform() {
        try {
            // Get architecture using uname
            const result = GLib.spawn_command_line_sync('uname -m');
            if (!result[0]) {
                this._log('Failed to detect architecture');
                return 'linux-x64'; // Default fallback
            }
            
            const arch = new TextDecoder().decode(result[1]).trim();
            this._log('Detected architecture: ' + arch);
            
            if (arch === 'x86_64') {
                return 'linux-x64';
            } else if (arch === 'aarch64' || arch === 'arm64') {
                return 'linux-arm64';
            } else {
                this._log('Unsupported architecture: ' + arch + ', defaulting to linux-x64');
                return 'linux-x64';
            }
        } catch (error) {
            this._log('Error detecting platform: ' + error);
            return 'linux-x64'; // Default fallback
        }
    }

    _parseJsonVersion(jsonText) {
        try {
            // Parse JSON response
            const jsonData = JSON.parse(jsonText);
            
            // Extract version from downloadUrl
            if (jsonData && jsonData.downloadUrl) {
                // The URL format appears to be something like:
                // https://anysphere-binaries.s3.us-east-1.amazonaws.com/production/client/linux/x64/appimage/Cursor-0.46.9-3395357a4ee2975d5d03595e7607ee84e3db0f2c.deb.glibc2.25-x86_64.AppImage
                // We need to extract the version (0.46.9) from it
                const versionMatch = jsonData.downloadUrl.match(/Cursor-([0-9]+\.[0-9]+\.[0-9]+)/);
                if (versionMatch && versionMatch[1]) {
                    this._log('Found version in download URL: ' + versionMatch[1]);
                    return versionMatch[1];
                }
            }
            this._log('Could not find version in JSON response');
            return null;
        } catch (error) {
            this._log('Error parsing JSON version: ' + error);
            return null;
        }
    }

    _parseNewJsonVersion(jsonText) {
        try {
            // Parse JSON response from new API
            const jsonData = JSON.parse(jsonText);
            
            // Extract version directly from the "version" field
            if (jsonData && jsonData.version) {
                this._log('Found version in new API response: ' + jsonData.version);
                return jsonData.version;
            }
            this._log('Could not find version in new API JSON response');
            return null;
        } catch (error) {
            this._log('Error parsing new JSON version: ' + error);
            return null;
        }
    }

    async _checkForUpdates() {
        this._log('Checking for updates');
        try {
            if (!this._settings.get_boolean('check-update')) {
                this._log('Update checking is disabled');
                return;
            }

            const localVersion = await this._getLocalVersion();
            if (!localVersion) {
                return;
            }

            // Get machine hash based on machine ID
            const machineHash = await this._getMachineHash();
            if (!machineHash) {
                this._log('Failed to get machine hash');
                return;
            }

            // Detect platform architecture
            const platform = this._detectPlatform();
            this._log(`Platform: ${platform}, Version: ${localVersion}, Hash: ${machineHash}`);

            // Use new API endpoint
            const apiUrl = `https://api2.cursor.sh/updates/api/update/${platform}/cursor/${localVersion}/${machineHash}/prerelease`;
            this._log(`API URL: ${apiUrl}`);

            // Make request with new headers
            const response = await this._makeHttpRequest(
                apiUrl,
                'GET',
                {
                    'host': 'api2.cursor.sh',
                    'user-agent': `Cursor/${localVersion}`,
                    'sec-fetch-site': 'none',
                    'sec-fetch-mode': 'no-cors',
                    'sec-fetch-dest': 'empty',
                    'accept-language': 'en-US',
                    'priority': 'u=4, i'
                }
            );

            // Handle different HTTP status codes
            if (response.status === 204) {
                this._log(`No update available. Current version ${localVersion} is up to date.`);
                return;
            } else if (response.status !== 200) {
                this._log(`API returned HTTP status ${response.status}: ${response.body}`);
                return;
            }

            const jsonText = response.body;
            
            // Parse version from new JSON format
            const latestVersion = this._parseNewJsonVersion(jsonText);
            if (!latestVersion) {
                this._log('Failed to parse latest version from JSON');
                return;
            }

            this._log(`Latest version: ${latestVersion}, Local version: ${localVersion}`);

            // Compare versions
            if (this._compareVersions(latestVersion, localVersion) > 0) {
                // If we have already shown a notification for this specific latestVersion,
                // and that notification object might still be active via this._lastNotification,
                // don't create a new one. The user will see the existing notification.
                if (this._notifiedVersion === latestVersion && this._lastNotification) {
                    this._log(`Notification for version ${latestVersion} already shown and may still be active.`);
                    return; // Do not proceed to recreate the notification
                }
                this._log(`New version ${latestVersion} detected. Current local version: ${localVersion}. Previously notified version: ${this._notifiedVersion}.`);

                this._log('New version available'); // Kept original log for now
                const systemSource = MessageTray.getSystemSource();

                // Destroy previous notification if it exists
                if (this._lastNotification) {
                    this._log('Destroying previous notification programmatically');
                    if (this._currentNotificationDestroyHandlerId && this._lastNotification.is_connected(this._currentNotificationDestroyHandlerId)) {
                        try {
                            this._lastNotification.disconnect(this._currentNotificationDestroyHandlerId);
                        } catch (e) {
                            this._log(`Error disconnecting notification destroy signal: ${e}`);
                        }
                    }
                    this._currentNotificationDestroyHandlerId = 0;
                    this._lastNotification.destroy();
                    this._lastNotification = null;
                }

                // Create new notification
                const notification = new MessageTray.Notification({
                    source: systemSource,
                    title: _('Cursor Update Available'),
                    body: _(`A new version (${latestVersion}) of Cursor is available. You are currently using version ${localVersion}.`),
                    urgency: MessageTray.Urgency.HIGH,
                });

                // Add changelog button
                notification.addAction(_('View Changelog'), () => {
                    Util.spawn(['xdg-open', 'https://www.cursor.com/changelog']);
                    this._log('Viewing changelog');
                });

                const newNotification = notification; // Use a clear variable name

                this._currentNotificationDestroyHandlerId = newNotification.connect('destroy', () => {
                    this._log('Notification self-destroyed (e.g., user closed it).');
                    // Check if the destroyed notification is the one we are currently tracking.
                    if (this._lastNotification === newNotification) {
                        this._lastNotification = null;
                        // This specific handler is for 'newNotification' which is now destroyed.
                        // Clear our stored ID as it's no longer active/relevant.
                        this._currentNotificationDestroyHandlerId = 0;
                        this._log('Cleared _lastNotification and its handler ID because the tracked notification was destroyed.');
                    } else {
                        this._log('A notification self-destroyed, but it was not the currently tracked _lastNotification. No state changed for _lastNotification.');
                    }
                });
                this._log(`Connected destroy signal for new notification. Handler ID: ${this._currentNotificationDestroyHandlerId}`);

                // Store reference to current notification
                this._lastNotification = newNotification;
                this._notifiedVersion = latestVersion; // Record the version we are notifying for

                // Show notification
                systemSource.addNotification(notification);
            } else {
                this._log(`No new version available. Local: ${localVersion}, Latest: ${latestVersion}.`);
                // If the current version is up-to-date or newer,
                // and we had a notification for a (now old or installed) version, clear it and reset notifiedVersion.
                if (this._lastNotification) {
                    this._log('Current version is up-to-date or newer. Clearing any existing/previous update notification.');
                    if (this._currentNotificationDestroyHandlerId && this._lastNotification.is_connected(this._currentNotificationDestroyHandlerId)) {
                        try {
                            this._lastNotification.disconnect(this._currentNotificationDestroyHandlerId);
                        } catch (e) {
                            this._log(`Error disconnecting notification destroy signal (else branch): ${e}`);
                        }
                    }
                    this._currentNotificationDestroyHandlerId = 0;
                    this._lastNotification.destroy();
                    this._lastNotification = null;
                }
                this._notifiedVersion = null; // Reset, as there's no "new" version we're tracking via notification.
            }
        } catch (error) {
            this._log('Error checking for updates: ' + error);
        }
    }

    _compareVersions(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const part1 = parts1[i] || 0;
            const part2 = parts2[i] || 0;
            
            if (part1 > part2) return 1;
            if (part1 < part2) return -1;
        }
        
        return 0;
    }

    _restartTimer() {
        this._startTimer();
    }

    // add a function to set common headers
    // Helper method to make HTTP requests via Go program to bypass Vercel Security Checkpoint
    async _makeHttpRequest(url, method = 'GET', customHeaders = {}, cookie = '', requestBody = null) {
        try {
            const config = {
                url: url,
                method: method,
                headers: {
                    'accept': '*/*',
                    'accept-language': 'en-US,en;q=0.9',
                    'dnt': '1',
                    'priority': 'u=1, i',
                    'referer': 'https://www.cursor.com/settings',
                    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Linux"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-origin',
                    ...customHeaders
                },
                cookie: cookie
            };

            // Add request body if provided
            if (requestBody !== null) {
                config.body = requestBody;
            }

            const configJSON = JSON.stringify(config);
            const extensionDir = this._extension_uuid ? `/home/${GLib.get_user_name()}/.local/share/gnome-shell/extensions/${this._extension_uuid}` : GLib.get_current_dir();
            
            this._log(`Making HTTP request via Go program: ${url}`);
            this._log(`Extension directory: ${extensionDir}`);
            
            const result = await spawnCommandAsync(`"${extensionDir}/cursor-api-http-client" '${configJSON}'`);
            
            if (!result.success) {
                this._log(`Go program failed with stderr: ${result.stderr}`);
                throw new Error(`Go program execution failed: ${result.stderr}`);
            }

            const responseText = result.stdout;
            const loggingText = result.stderr;
            this._log(`Go program logging: ${loggingText}`);
            this._log(`Go program response: ${responseText}`);
            
            try {
                const response = JSON.parse(responseText);
                return {
                    status: response.status,
                    body: response.body,
                    headers: response.headers
                };
            } catch (parseError) {
                this._log(`Failed to parse JSON response: ${parseError}`);
                throw new Error(`Failed to parse response: ${responseText}`);
            }
        } catch (error) {
            this._log(`HTTP request error: ${error}`);
            throw error;
        }
    }

    _setCommonHeaders(message) {
        message.request_headers.append('accept', '*/*');
        message.request_headers.append('accept-language', 'en-US,en;q=0.9');
        message.request_headers.append('dnt', '1');
        message.request_headers.append('priority', 'u=1, i');
        message.request_headers.append('referer', 'https://www.cursor.com/settings');
        message.request_headers.append('sec-ch-ua', '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"');
        message.request_headers.append('sec-ch-ua-mobile', '?0');
        message.request_headers.append('sec-ch-ua-platform', '"Linux"');
        message.request_headers.append('sec-fetch-dest', 'empty');
        message.request_headers.append('sec-fetch-mode', 'cors');
        message.request_headers.append('sec-fetch-site', 'same-origin');
    }

    async _updateUsage() {
        try {
            // Add cookie from settings
            const cookie = this._settings.get_string('cookie');
            if (!cookie) {
                this._log('Cookie is not set');
                return;
            }

            // Extract user_id from cookie
            const decodedCookie = decodeURIComponent(cookie);
            const user_id = decodedCookie.split('=')[1].split('::')[0];
            if (!user_id) {
                this._log('User ID is not set');
                return;
            }
            this._log(`User ID: ${user_id}`);

            // Make request via Go program to bypass Vercel Security Checkpoint
            const response = await this._makeHttpRequest(
                `https://www.cursor.com/api/usage?user=${user_id}`,
                'GET',
                {},
                cookie
            );

            this._log(`Received data: ${response.body}`);
            const data = JSON.parse(response.body);
            
            if (response.status === 401 || data.statusCode === 401) {
                this._log('Unauthorized, invalid cookie');
                this.buttonText.set_text('Unauthorized');
                return;
            }

            this._usage = data;

            // Get team info and user analytics
            await this._getTeamInfo();
            await this._getUserAnalytics();

            this._updateDisplay();
        } catch (error) {
            this._log('Error fetching Cursor usage data: ' + error);
            this.buttonText.set_text('Error');
        }
    }

    async _getTeamInfo() {
        try {
            const cookie = this._settings.get_string('cookie');
            if (!cookie) {
                this._log('Cookie is not set for team info');
                return;
            }

            const response = await this._makeHttpRequest(
                'https://cursor.com/api/dashboard/teams',
                'POST',
                {
                    'content-type': 'application/json',
                    'origin': 'https://cursor.com',
                    'referer': 'https://cursor.com/analytics'
                },
                cookie,
                '{}'
            );

            this._log(`Received team info: ${response.body}`);
            const teamData = JSON.parse(response.body);
            
            if (teamData.teams && teamData.teams.length > 0) {
                this._teamInfo = teamData.teams[0]; // Use first team
                this._log(`Team ID: ${this._teamInfo.id}, Team Name: ${this._teamInfo.name}`);
            } else {
                this._log('No teams found');
                this._teamInfo = null;
            }
        } catch (error) {
            this._log('Error fetching team info: ' + error);
            this._teamInfo = null;
        }
    }

    async _getUserAnalytics() {
        try {
            if (!this._teamInfo) {
                this._log('No team info available for analytics');
                this._userAnalytics = null;
                return;
            }

            const cookie = this._settings.get_string('cookie');
            if (!cookie) {
                this._log('Cookie is not set for user analytics');
                return;
            }

            // Calculate recent 7 day
            const now = new Date();
            // Set endDate to start of yesterday (00:00:00)
            const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            // Set startDate to 7 days before endDate (00:00:00)
            const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 8);

            const requestBody = {
                teamId: this._teamInfo.id,
                userId: 0,
                startDate: startDate.getTime().toString(),
                endDate: endDate.getTime().toString()
            };

            const response = await this._makeHttpRequest(
                'https://cursor.com/api/dashboard/get-user-analytics',
                'POST',
                {
                    'content-type': 'application/json',
                    'origin': 'https://cursor.com',
                    'referer': 'https://cursor.com/analytics'
                },
                cookie,
                JSON.stringify(requestBody)
            );

            this._log(`Received user analytics: ${response.body}`);
            const analyticsData = JSON.parse(response.body);
            this._userAnalytics = analyticsData;
            this._log(`Lines rank: ${analyticsData.applyLinesRank}/${analyticsData.totalTeamMembers}, Tabs rank: ${analyticsData.tabsAcceptedRank}/${analyticsData.totalTeamMembers}`);
        } catch (error) {
            this._log('Error fetching user analytics: ' + error);
            this._userAnalytics = null;
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
        const remainingPercent = Math.floor(((monthlyQuota - numRequests) / monthlyQuota) * 100);
        const usedPercent = Math.floor((numRequests / monthlyQuota) * 100);

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

        // reset date
        const startOfMonth = this._usage.startOfMonth;
        // convert utc date to local time `"startOfMonth":"2025-01-09T01:02:03.000Z"`
        const resetDate = new Date(startOfMonth);
        // calculate next reset date (add one month)
        const nextResetDate = new Date(resetDate);
        nextResetDate.setMonth(nextResetDate.getMonth() + 1);

        // calculate days passed percentage in current reset cycle
        const today = new Date();
        const daysPassed = Math.floor((today - resetDate) / (1000 * 60 * 60 * 24)) + 1;
        const totalDays = Math.floor((nextResetDate - resetDate) / (1000 * 60 * 60 * 24));
        const daysPassedPercent = Math.floor((daysPassed / totalDays) * 100);

        const resetDateFormated = dateToRFC3339(resetDate);
        const nextResetDateFormated = dateToRFC3339(nextResetDate);
        const usageResetDate = new PopupMenu.PopupMenuItem('', { reactive: false });
        usageResetDate.label.text = `Reset Start: ${resetDateFormated}\nReset Next: ${nextResetDateFormated}\nDays Passed: ${daysPassed}/${totalDays} (${daysPassedPercent}%)`;
        this.menuLayout.addMenuItem(usageResetDate);

        // add monthly usage percentage
        const monthlyUsage = new PopupMenu.PopupMenuItem('', { reactive: false });
        monthlyUsage.label.text = `Premium Requests Used: ${numRequests} / ${monthlyQuota} (${usedPercent}%)`;
        this.menuLayout.addMenuItem(monthlyUsage);

        // Add ranking information if available
        this._addRankingInfo();

        // Add menu items for each model
        for (const [model, data] of Object.entries(this._usage)) {
            // filter entry: only if data is object and has numRequests and numTokens properties
            // for skip none usage entry like `"startOfMonth":"2025-01-09T01:02:03.000Z"`
            if (typeof data !== 'object' || 
                !data.hasOwnProperty('numRequests') || 
                !data.hasOwnProperty('numTokens')) {
                continue;
            }

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

    _addRankingInfo() {
        // Only display ranking info if we have the data
        if (!this._userAnalytics || !this._teamInfo) {
            this._log('No ranking data available');
            return;
        }

        const analytics = this._userAnalytics;

        // Add separator before ranking info
        this.menuLayout.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Lines of Code Accepted Ranking
        const linesRankingItem = new PopupMenu.PopupMenuItem('', { reactive: false });
        linesRankingItem.label.text = `Lines of Code Accepted Ranking: ${analytics.applyLinesRank} of ${analytics.totalTeamMembers}`;
        this.menuLayout.addMenuItem(linesRankingItem);

        const linesDetailsItem = new PopupMenu.PopupMenuItem('', { reactive: false });
        linesDetailsItem.label.text = `Your Total Lines of Code Accepted:   ${analytics.totalApplyLines.toLocaleString()}\nTeam Average (per active user in period): ${analytics.teamAverageApplyLines.toLocaleString()}`;
        this.menuLayout.addMenuItem(linesDetailsItem);

        // Add separator between the two ranking sections
        this.menuLayout.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Tabs Accepted Ranking
        const tabsRankingItem = new PopupMenu.PopupMenuItem('', { reactive: false });
        tabsRankingItem.label.text = `Tabs Accepted Ranking: ${analytics.tabsAcceptedRank} of ${analytics.totalTeamMembers}`;
        this.menuLayout.addMenuItem(tabsRankingItem);

        const tabsDetailsItem = new PopupMenu.PopupMenuItem('', { reactive: false });
        tabsDetailsItem.label.text = `Your Total Tabs Accepted: ${analytics.totalTabsAccepted.toLocaleString()}\nTeam Average (per active user in period): ${analytics.teamAverageTabsAccepted.toLocaleString()}`;
        this.menuLayout.addMenuItem(tabsDetailsItem);

        // Add click events to copy ranking text to clipboard
        linesRankingItem.connect('activate', () => {
            const copyText = `Lines of Code Accepted Ranking: ${analytics.applyLinesRank} of ${analytics.totalTeamMembers}\nYour Total Lines of Code Accepted: ${analytics.totalApplyLines.toLocaleString()}\nTeam Average: ${analytics.teamAverageApplyLines.toLocaleString()}`;
            this._log(`Copied lines ranking to clipboard: ${copyText}`);
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, copyText);
        });

        linesDetailsItem.connect('activate', () => {
            const copyText = `Lines of Code Accepted Ranking: ${analytics.applyLinesRank} of ${analytics.totalTeamMembers}\nYour Total Lines of Code Accepted: ${analytics.totalApplyLines.toLocaleString()}\nTeam Average: ${analytics.teamAverageApplyLines.toLocaleString()}`;
            this._log(`Copied lines details to clipboard: ${copyText}`);
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, copyText);
        });

        tabsRankingItem.connect('activate', () => {
            const copyText = `Tabs Accepted Ranking: ${analytics.tabsAcceptedRank} of ${analytics.totalTeamMembers}\nYour Total Tabs Accepted: ${analytics.totalTabsAccepted.toLocaleString()}\nTeam Average: ${analytics.teamAverageTabsAccepted.toLocaleString()}`;
            this._log(`Copied tabs ranking to clipboard: ${copyText}`);
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, copyText);
        });

        tabsDetailsItem.connect('activate', () => {
            const copyText = `Tabs Accepted Ranking: ${analytics.tabsAcceptedRank} of ${analytics.totalTeamMembers}\nYour Total Tabs Accepted: ${analytics.totalTabsAccepted.toLocaleString()}\nTeam Average: ${analytics.teamAverageTabsAccepted.toLocaleString()}`;
            this._log(`Copied tabs details to clipboard: ${copyText}`);
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, copyText);
        });
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

        // Clean up notification and its handler
        if (this._lastNotification && this._currentNotificationDestroyHandlerId) {
            if (this._lastNotification.is_connected(this._currentNotificationDestroyHandlerId)) {
                try {
                    this._lastNotification.disconnect(this._currentNotificationDestroyHandlerId);
                    this._log('Disconnected notification destroy handler in main destroy().');
                } catch(e) {
                    this._log(`Error disconnecting notification destroy signal in main destroy(): ${e}`);
                }
            }
        }
        this._currentNotificationDestroyHandlerId = 0; // Clear the handler ID

        if (this._lastNotification) {
            this._log('Destroying last notification in main destroy().');
            this._lastNotification.destroy();
            this._lastNotification = null;
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
            const timestamp = dateToRFC3339(new Date());
            log(`[Cursor Usage] [${timestamp}] ${message}`);
        }
    }

    async _updateUserInfo() {
        try {
            // Check if cookie exists
            const cookie = this._settings.get_string('cookie');
            if (!cookie) {
                this._log('Cookie is not set, skipping user info update');
                return;
            }

            // Make request via Go program to bypass Vercel Security Checkpoint
            const response = await this._makeHttpRequest(
                'https://www.cursor.com/api/auth/me',
                'GET',
                {},
                cookie
            );
            
            this._log(`Received user info: ${response.body}`);
            
            // response JSON example:
            /*
            {
                "email": "user@example.com",
                "email_verified": true,
                "name": "",
                "sub": "user_xxxxxxxxxxxxxxxxxxxxxxxxxx",
                "updated_at": "2024-01-01T01:02:03.000Z",
                "picture": null
            }
            */
            const userData = JSON.parse(response.body);
            
            // Save user info to settings
            if (userData.sub) {
                this._settings.set_string('user', JSON.stringify(userData));
                this._log(`Updated user info: ${JSON.stringify(userData)}`);
            } else {
                this._log('No user info found');
            }
        } catch (error) {
            this._log('Error fetching user info: ' + error);
        }
    }
});

function dateToRFC3339(date) {
    // Get timezone offset in minutes
    const tzOffset = -date.getTimezoneOffset();
    const tzHours = String(Math.abs(Math.floor(tzOffset / 60))).padStart(2, '0');
    const tzMinutes = String(Math.abs(tzOffset % 60)).padStart(2, '0');
    const tzSign = tzOffset >= 0 ? '+' : '-';

    // Format datetime in RFC3339 with local timezone
    return date.getFullYear() +
        '-' + String(date.getMonth() + 1).padStart(2, '0') +
        '-' + String(date.getDate()).padStart(2, '0') +
        'T' + String(date.getHours()).padStart(2, '0') +
        ':' + String(date.getMinutes()).padStart(2, '0') +
        ':' + String(date.getSeconds()).padStart(2, '0') +
        tzSign + tzHours + ':' + tzMinutes;
}

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