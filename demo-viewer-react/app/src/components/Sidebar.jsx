/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Link, useLocation } from 'react-router-dom';
import './Sidebar.css';
import { useZoomContext } from '../context/ZoomContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { ViewHelper } from 'three/examples/jsm/Addons.js';

function Sidebar() {
  const location = useLocation();
  const { zoomLevel } = useZoomContext();
  const { theme, toggleTheme } = useTheme();

  const menuItems = [
    { path: '/', label: 'Map' },
    { path: '/drillhole', label: '3D Scene' },
    { path: '/drillhole-2d', label: 'Strip Log' },
    { path: '/strip-log-gallery', label: 'Strip Log Gallery' },
    { path: '/block-model', label: 'Block Models' },
    { path: '/polygon-blocks', label: 'Polygon Blocks' },
    { path: '/core-photo', label: 'Core Photos' },
    { path: '/analytics', label: 'Analytics Plots' },
    { path: '/idw-volume', label: 'IDW Volume' },
    { path: '/geophysics-raster', label: 'Geophysics Raster' },
    { path: '/chat-helpers', label: 'Chat Helpers' },
    // { path: '/raster-demo', label: 'Raster Overlay' },
  ];

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <h2>Baselode</h2>
        <h2>Demo Viewer</h2>
        <span className="sidebar-version">v{__APP_VERSION__}</span>
        <button
          type="button"
          className="sidebar-theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? '☀ Light' : '☾ Dark'}
        </button>
      </div>
      <ul className="sidebar-menu">
        {menuItems.map((item) => (
          <li key={item.path}>
            <Link 
              to={item.path}
              className={location.pathname === item.path ? 'active' : ''}
            >
              <span className="label">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div id="map-controls-slot" className="sidebar-slot" />
      <div className="sidebar-footer">
        <div id="data-source-slot" className="data-source-info" />
        {location.pathname === '/' && (
          <span className="zoom-label">Zoom: {zoomLevel}</span>
        )}
      </div>
      <div className="sidebar-source-link">
        <Link to="/attribution" className={location.pathname === '/attribution' ? 'active' : ''}>
          Data Attribution
        </Link>
        <br />
        <a href="https://github.com/darkmine-oss/baselode" target="_blank" rel="noopener noreferrer">
          Source Code
        </a>
      </div>
    </nav>
  );
}

export default Sidebar;
