/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import './Attribution.css';

function Attribution() {
  return (
    <div className="attribution-page">
      <h1>Demo Data &amp; Attribution</h1>

      <section className="attribution-section">
        <p>
          All data displayed in this demo viewer is a <strong>sample subset</strong> of
          the <strong>GSWA Geochemistry (DMIRS-047)</strong> dataset, used solely to
          demonstrate the capabilities of the Baselode library. It does not represent
          comprehensive exploration results or any commercial dataset.
        </p>
      </section>

      <section className="attribution-section">
        <h2>Source</h2>
        <ul>
          <li>
            Dataset portal (DASC):{' '}
            <a href="https://dasc.dmirs.wa.gov.au/home?productAlias=GSWAGeochem" target="_blank" rel="noopener noreferrer">
              dasc.dmirs.wa.gov.au
            </a>
          </li>
          <li>
            Data WA catalogue:{' '}
            <a href="https://catalogue.data.wa.gov.au/dataset/gswa-geochemistry" target="_blank" rel="noopener noreferrer">
              catalogue.data.wa.gov.au
            </a>
          </li>
          <li>Date accessed: 2026-02-11</li>
        </ul>
      </section>

      <section className="attribution-section">
        <h2>Licence</h2>
        <p>
          The sample data files are licensed under{' '}
          <strong>Creative Commons Attribution 4.0 International (CC BY 4.0)</strong>.{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noopener noreferrer">
            Licence text
          </a>
        </p>
        <blockquote>
          © State of Western Australia (Department of Mines, Petroleum and Exploration) 2025
          <br />
          Attribution: Based on Department of Mines, Petroleum and Exploration material.
        </blockquote>
      </section>

      <section className="attribution-section">
        <h2>Changes made</h2>
        <p>
          The sample CSV files are subsets and format-converted extracts from the upstream
          dataset (selection/filtering and conversion to CSV), filtered to collars within
          a bounding box near Hyden, Western Australia.
        </p>
      </section>

      <section className="attribution-section">
        <h2>No endorsement</h2>
        <p>
          Use of these samples does not imply endorsement by the State of Western Australia
          or the Department of Mines, Petroleum and Exploration.
        </p>
      </section>
    </div>
  );
}

export default Attribution;
