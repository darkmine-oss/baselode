/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createContext, useContext, useState } from 'react';

const ZoomContext = createContext({ zoomLevel: 5, setZoomLevel: () => {} });

export function ZoomProvider({ children }) {
  const [zoomLevel, setZoomLevel] = useState(5);
  return (
    <ZoomContext.Provider value={{ zoomLevel, setZoomLevel }}>
      {children}
    </ZoomContext.Provider>
  );
}

export function useZoomContext() {
  return useContext(ZoomContext);
}
