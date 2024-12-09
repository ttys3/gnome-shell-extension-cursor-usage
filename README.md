# GNOME Shell Extension - Cursor Usage Stats

A GNOME Shell extension that displays Cursor AI editor usage statistics in your top panel indicator area.

[Cursor](https://www.cursor.com/) is an AI-powered code editor that helps developers write code more efficiently through AI assistance.

<div style="display: flex; height: 400px;">
    <img src="https://github.com/user-attachments/assets/6d5f9aeb-598d-4795-aa86-7d545da13cc4" style="width: 340px; margin-right: 20px;">
    <img src="https://github.com/user-attachments/assets/40d61826-c181-46fb-90ee-71a87517b6f8" style="width: 480px;">
</div>

## Features

- Displays Cursor AI usage statistics in GNOME Shell top panel
- Monitor your daily interaction with AI coding assistant
- Quick access to usage information without leaving your workflow

## Installation

1. Clone the repository:
   
   ```bash
   cd ~/.local/share/gnome-shell/extensions/
   git clone https://github.com/ttys3/gnome-shell-extension-cursor-usage.git cursor-usage@ttys3.github.io
   ```

2. Change to extension directory:
   ```bash
   cd cursor-usage@ttys3.github.io
   ```

3. Install extension to your home directory:
   ```bash
   make install
   ```

4. Log Out and Log In to your GNOME Shell session to refresh the extension list.

5. Enable the extension using GNOME Extensions app or run the following command:

   ```bash
   gnome-extensions enable cursor-usage@ttys3.github.io
   ```

## Configuration

After enabling the extension:

1. Click the extension icon in the top panel, and then click "Preferences"
2. Configure the following options:
   - User ID and Cookies for API request
   - Monthly premium API usage quota
   - Update frequency

## Requirements

- GNOME Shell 46 or later
- Cursor AI editor installed on your system (if you do not use Cursor AI editor, this extension is useless)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Credits

- Cursor AI Editor - [https://www.cursor.com/](https://www.cursor.com/)

this extension is mostly written by Cursor AI editor.


## Refs

https://gnome.pages.gitlab.gnome.org/libsoup/libsoup-3.0/struct.MessageHeaders.html

https://gjs-docs.gnome.org/gio20~2.0/gio.settings#method-set_string

https://gjs-docs.gnome.org/gio20~2.0/gio.notification
