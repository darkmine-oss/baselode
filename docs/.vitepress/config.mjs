import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Baselode',
  description: 'Open-source toolkit for the mineral exploration and mining industries',
  base: '/',
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/baselode_logo.png' }]
  ],

  themeConfig: {
    logo: '/baselode_logo.png',
    siteTitle: 'Baselode',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      {
        text: 'Guide',
        items: [
          { text: 'Python', link: '/guide/python' },
          { text: 'JavaScript', link: '/guide/javascript' },
          { text: 'Core Photo Viewer', link: '/guide/core-photo-viewer' },
          { text: 'Attribute promotion', link: '/guide/attribute-expansion' },
          { text: 'Structural observations', link: '/guide/structural-observations' }
        ]
      },
      {
        text: 'Demos',
        items: [
          { text: 'Demo applications', link: '/demos' },
          { text: 'Strip-log gallery', link: '/strip-log-gallery' }
        ]
      },
      { text: 'Release Notes', link: '/release-notes' },
      {
        text: 'API Reference',
        items: [
          { text: 'Python API', link: '/api/python' },
          { text: 'JavaScript API', link: '/api/javascript' }
        ]
      },
      {
        text: 'GitHub',
        link: 'https://github.com/darkmine-oss/baselode'
      }
    ],

    sidebar: {
      '/getting-started': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Overview', link: '/getting-started' },
            { text: 'Python Guide', link: '/guide/python' },
            { text: 'JavaScript Guide', link: '/guide/javascript' },
            { text: 'Demos', link: '/demos' },
            { text: 'Strip-log gallery', link: '/strip-log-gallery' }
          ]
        }
      ],
      '/guide/': [
        {
          text: 'Python',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/guide/python' },
            { text: 'Data Loading', link: '/guide/python#data-loading' },
            { text: 'Desurveying', link: '/guide/python#desurveying' },
            { text: 'DrillholeSet', link: '/guide/python#drillholeset-the-composition-root' },
            { text: 'Database Validation', link: '/guide/python#database-validation' },
            { text: 'OMF interop', link: '/guide/python#omf-interop-open-mining-format' },
            { text: 'Interval Algebra', link: '/guide/python#interval-algebra' },
            { text: 'Compositing', link: '/guide/python#compositing' },
            { text: 'Block Models', link: '/guide/python#block-models' },
            { text: 'Visualization', link: '/guide/python#visualization' },
            { text: 'Plotly Templates', link: '/guide/python#plotly-templates' },
            { text: 'Colour Mapping', link: '/guide/python#colour-mapping' },
            { text: 'Geophysics Rasters', link: '/guide/python#geophysics-rasters' },
            { text: 'Jupyter Notebooks', link: '/guide/python#using-with-jupyter-notebooks' }
          ]
        },
        {
          text: 'JavaScript',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/guide/javascript' },
            { text: 'Data Loading', link: '/guide/javascript#data-loading' },
            { text: 'Desurveying', link: '/guide/javascript#desurveying' },
            { text: 'DrillholeSet', link: '/guide/javascript#drillholeset-the-composition-root' },
            { text: 'Database Validation', link: '/guide/javascript#database-validation' },
            { text: 'Interval Algebra', link: '/guide/javascript#interval-algebra' },
            { text: 'Compositing', link: '/guide/javascript#compositing' },
            { text: 'Block Models', link: '/guide/javascript#block-models' },
            { text: '3D Interpolation Volumes', link: '/guide/javascript#_3d-interpolation-volumes' },
            { text: 'Spatial Extents', link: '/guide/javascript#spatial-extents' },
            { text: 'Visualization', link: '/guide/javascript#visualization' },
            { text: 'Tool UI', link: '/guide/javascript#tool-ui' },
            { text: 'Plotly Templates', link: '/guide/javascript#plotly-templates' },
            { text: 'Colour Mapping', link: '/guide/javascript#colour-mapping' },
            { text: '3D Scene', link: '/guide/javascript#_3d-scene' },
            { text: '3D Sections and Slabs', link: '/guide/javascript#_3d-sections-and-slabs' },
            { text: 'Geophysics Rasters', link: '/guide/javascript#geophysics-raster-viewer' },
            { text: 'Raster Overlays', link: '/guide/javascript#raster-overlays' },
            { text: 'Terrain Surface', link: '/guide/javascript#terrain-surface' }
          ]
        },
        {
          text: 'Data Topics',
          collapsed: false,
          items: [
            { text: 'Attribute promotion', link: '/guide/attribute-expansion' },
            { text: 'Structural observations', link: '/guide/structural-observations' }
          ]
        },
        {
          text: 'Core Photo Viewer',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/guide/core-photo-viewer' },
            { text: 'Preparing your data', link: '/guide/core-photo-viewer#preparing-your-data' },
            { text: 'Single hole', link: '/guide/core-photo-viewer#single-hole' },
            { text: 'Multiple photo sets', link: '/guide/core-photo-viewer#multiple-photo-sets' },
            { text: 'Multiple datasets for one hole', link: '/guide/core-photo-viewer#multiple-datasets-for-one-hole' },
            { text: 'Comparing multiple holes', link: '/guide/core-photo-viewer#comparing-multiple-holes' },
            { text: 'Linked pan/zoom', link: '/guide/core-photo-viewer#linked-pan-zoom-across-independent-viewers' },
            { text: 'Filename conventions', link: '/guide/core-photo-viewer#filename-conventions' },
            { text: 'Local development', link: '/guide/core-photo-viewer#local-development' },
            { text: 'API reference', link: '/guide/core-photo-viewer#full-api-reference' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Python API', link: '/api/python' },
            { text: 'JavaScript API', link: '/api/javascript' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/darkmine-oss/baselode' }
    ],

    footer: {
      message: 'Released under the GPL-3.0-or-later License.',
      copyright: 'Copyright © 2026 <a href="https://darkmine.ai" target="_blank" rel="noopener">Darkmine Pty Ltd</a>'
    },

    search: {
      provider: 'local'
    }
  }
})
