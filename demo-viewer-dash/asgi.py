# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

from asgiref.wsgi import WsgiToAsgi

from app import app as dash_app

app = WsgiToAsgi(dash_app.server)
