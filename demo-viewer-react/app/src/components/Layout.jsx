/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Sidebar from './Sidebar.jsx';
import '../App.css';
import { ZoomProvider } from '../context/ZoomContext.jsx';
import { DemoDataProvider } from '../context/DemoDataContext.jsx';
import { ThemeProvider } from '../context/ThemeContext.jsx';

function Layout({ children }) {
  return (
    <ThemeProvider>
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
    </ThemeProvider>
  );
}

export default Layout;
