/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Sidebar from './Sidebar.jsx';
import '../App.css';
import { ZoomProvider } from '../context/ZoomContext.jsx';

function Layout({ children }) {
  return (
    <ZoomProvider>
      <div className="app-container">
        <Sidebar />
        <main className="main-content">
          {children}
        </main>
      </div>
    </ZoomProvider>
  );
}

export default Layout;
