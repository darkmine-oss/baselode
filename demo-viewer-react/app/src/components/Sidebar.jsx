/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Link, useLocation } from 'react-router-dom';
import './Sidebar.css';
import { useZoomContext } from '../context/ZoomContext.jsx';

function Sidebar() {
  const location = useLocation();
  const { zoomLevel } = useZoomContext();

  const menuItems = [
    { path: '/', label: 'Map' },
    { path: '/drillhole', label: 'Drillhole' },
    { path: '/drillhole-2d', label: 'Drillhole 2D' },
    { path: '/block-model', label: 'Block Model' },
    { path: '/config', label: 'Config' }
  ];

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <h2>Baselode Viewer</h2>
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
        <span className="zoom-label">Zoom: {zoomLevel}</span>
      </div>
    </nav>
  );
}

export default Sidebar;
