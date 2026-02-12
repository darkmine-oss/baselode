/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Sidebar from './Sidebar.jsx';
import '../App.css';
import { ZoomProvider } from '../context/ZoomContext.jsx';
import { DrillConfigProvider } from '../context/DrillConfigContext.jsx';

function Layout({ children }) {
  return (
    <DrillConfigProvider>
      <ZoomProvider>
        <div className="app-container">
          <Sidebar />
          <main className="main-content">
            {children}
          </main>
        </div>
      </ZoomProvider>
    </DrillConfigProvider>
  );
}

export default Layout;
