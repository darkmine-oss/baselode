/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Routes, Route } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import Layout from './components/Layout';
import Home from './pages/Home';
import Drillhole from './pages/Drillhole';
import Drillhole2D from './pages/Drillhole2D';
import StripLogGallery from './pages/StripLogGallery';
import BlockModel from './pages/BlockModel';
import PolygonBlocks from './pages/PolygonBlocks';
import Attribution from './pages/Attribution';
import CorePhoto from './pages/CorePhoto';
import ChatHelpers from './pages/ChatHelpers';
import AnalyticsPlots from './pages/AnalyticsPlots';
import IdwVolume from './pages/IdwVolume';
// import RasterDemo from './pages/RasterDemo';
import './App.css';

function App() {
  return (
    <>
    <Analytics />
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/drillhole" element={<Drillhole />} />
        <Route path="/drillhole-2d" element={<Drillhole2D />} />
        <Route path="/strip-log-gallery" element={<StripLogGallery />} />
        <Route path="/block-model" element={<BlockModel />} />
        <Route path="/polygon-blocks" element={<PolygonBlocks />} />
        <Route path="/attribution" element={<Attribution />} />
        <Route path="/core-photo" element={<CorePhoto />} />
        <Route path="/chat-helpers" element={<ChatHelpers />} />
        <Route path="/analytics" element={<AnalyticsPlots />} />
        <Route path="/idw-volume" element={<IdwVolume />} />
        {/* <Route path="/raster-demo" element={<RasterDemo />} /> */}
      </Routes>
    </Layout>
    </>
  );
}

export default App;
