#!/usr/bin/env bash

set -eou pipefail

journalctl --user -r | rg cursor-usage

