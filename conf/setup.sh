#!/bin/bash

set -euo pipefail

# --- HARDWARE PERMISSIONS ---
# If this service requires hardware access, you likely need a udev rule
# to assign ownership to the 'scratch' user.
# Example: /etc/udev/rules.d/99-scratch.rules
# SUBSYSTEM=="usb", ATTRS{idVendor}=="XXXX", OWNER="scratch"
# ----------------------------

echo "Linking sysusers config..."

mkdir -p /etc/sysusers.d

if [ -f /etc/sysusers.d/scratch.conf ]; then
    rm /etc/sysusers.d/scratch.conf
fi

ln -s "/path/to/scratch/conf/scratch.conf" /etc/sysusers.d/scratch.conf

echo "Creating user..."

systemd-sysusers

echo "Linking unit..."

if [ -f /etc/systemd/system/scratch.service ]; then
    rm /etc/systemd/system/scratch.service
fi

systemctl link "/path/to/scratch/conf/scratch.service"

if command -v logrotate >/dev/null 2>&1; then
    echo "Linking logrotate config..."

    if [ -f /etc/logrotate.d/scratch ]; then
        rm /etc/logrotate.d/scratch
    fi

    ln -s "/path/to/scratch/conf/scratch_logs.conf" /etc/logrotate.d/scratch
else
    echo "Logrotate not found, skipping..."
fi

echo "Reloading daemon..."

systemctl daemon-reload
systemctl enable scratch

echo "Fixing initial permissions..."

mkdir -p "/path/to/scratch/logs"

chown -R scratch:scratch "/path/to/scratch"

find "/path/to/scratch" -type d -exec chmod 755 {} +
find "/path/to/scratch" -type f -exec chmod 644 {} +

chmod +x "/path/to/scratch/scratch"

echo "Setup complete, starting service..."

service scratch restart

echo "Done."
