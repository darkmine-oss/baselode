# Structural observations and plotting depth

Structural `dip`/`azimuth` describe a plane: azimuth is dip direction, not hole
azimuth. Source signs, angle units and north references require validation.
Core `alpha`/`beta` remain distinct and require a validated survey and core
reference convention before conversion to plane orientation.

For preserving GSWA exports, one row represents one source observation. The
flat table retains source `from`/`to` bounds and uses `depth = from` as its point
plotting anchor. A missing end depth stays null; an absent end-depth source
column need not be created. The plotting anchor does not replace interval extent.
`plot_tadpole_log` and `structural_to_tadpole` use the supplied depth column without
inferring a midpoint. Alternative anchors must be prepared explicitly.

Tadpole plots require complete dip/dip-direction measurements. They do not
render descriptor-only or alpha/beta-only observations as fabricated planes.
Orientation normalization and alpha/beta interpretation are separate from
source-preserving conversion.
