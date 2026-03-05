/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Sidebar from './Sidebar.jsx';
import '../App.css';
import { ZoomProvider } from '../context/ZoomContext.jsx';
import { DemoDataProvider } from '../context/DemoDataContext.jsx';

function Layout({ children }) {
  return (
    <ZoomProvider>
      <DemoDataProvider>
        <div className="app-container">
          <Sidebar />
          <main className="main-content">
            {children}
          </main>
        </div>
      </DemoDataProvider>
    </ZoomProvider>
  );
}

export default Layout;
