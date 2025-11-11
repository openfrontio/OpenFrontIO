#!/bin/bash
set -e

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
