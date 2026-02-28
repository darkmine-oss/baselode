/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Drillhole from './pages/Drillhole';
import Drillhole2D from './pages/Drillhole2D';
import BlockModel from './pages/BlockModel';
import './App.css';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/drillhole" element={<Drillhole />} />
        <Route path="/drillhole-2d" element={<Drillhole2D />} />
        <Route path="/block-model" element={<BlockModel />} />
      </Routes>
    </Layout>
  );
}

export default App;
