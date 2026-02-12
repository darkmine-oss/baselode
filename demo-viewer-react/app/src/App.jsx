/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Drillhole from './pages/Drillhole';
import Drillhole2D from './pages/Drillhole2D';
import BlockModel from './pages/BlockModel';
import Config from './pages/Config';
import './App.css';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/drillhole" element={<Drillhole />} />
        <Route path="/drillhole-2d" element={<Drillhole2D />} />
        <Route path="/block-model" element={<BlockModel />} />
        <Route path="/config" element={<Config />} />
      </Routes>
    </Layout>
  );
}

export default App;
