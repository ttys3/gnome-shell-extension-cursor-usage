#!/usr/bin/env bash

set -eou pipefail

journalctl -f -o cat /usr/bin/gnome-shell | grep "Cursor Usage"

