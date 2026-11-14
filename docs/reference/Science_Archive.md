# SPHEREx Science Archive Guide

Curated operational and scientific notes from the [SPHEREx Data Explorer Online Help](https://irsa.ipac.caltech.edu/onlinehelp/spherex/). This is a paraphrased guide to the parts relevant to Spectra's data discovery, interpretation, visualization, and processing. The IRSA manual describes a live service and may change; verify release-specific details against the product headers and the SPHEREx Explanatory Supplement.

## Contents

- [Archive and instrument model](#archive-and-instrument-model)
- [Search and coverage](#search-and-coverage)
- [Results and linked views](#results-and-linked-views)
- [Upload and input files](#upload-and-input-files)
- [Visualization and FITS cubes](#visualization-and-fits-cubes)
- [Tables, catalogs, and other searches](#tables-catalogs-and-other-searches)
- [Plots and spectra](#plots-and-spectra)
- [Spectrophotometry](#spectrophotometry)
- [Mosaics](#mosaics)
- [Downloads, cutouts, and jobs](#downloads-cutouts-and-jobs)
- [Examples and performance lessons](#examples-and-performance-lessons)
- [Implications for Spectra](#implications-for-spectra)
- [Source index](#source-index)

## Archive and instrument model

SPHEREx measures the sky with a linear-variable filter (LVF). A detector image therefore has spatially varying wavelength: a sky location's spectrum is assembled from observations obtained at different times and detector positions. Do not treat one exposure as a conventional broadband image with one wavelength per detector. Keep the exposure time, detector/band identity, spatial WCS, wavelength solution, variance, and flags associated with each sample. [Overview](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/overview.html)

The online help describes six detector bands spanning approximately 0.75–5.0 microns, with unequal spectral resolving power. Simultaneous image pairs share a footprint: D1/D4, D2/D5, and D3/D6. Other bands in a spectrum are collected at different times. Consequently, simultaneous-pair display is useful, but arbitrary cross-band image subtraction or assuming identical coverage is not scientifically justified. Obtain exact wavelength solutions from the product data and applicable release documentation rather than relying on nominal band edges. [Overview](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/overview.html) · [Search Results](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/results.html)

The help describes QR2 imaging available both at IPAC and in cloud storage. Some interactive processing services (including IRSA Mosaic, Spectrophotometry, and Cutout) use the on-premises copy. Service availability, data freshness, and product release are separate facts; label which collection/release and source generated each result. [FAQ](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/faq.html)

## Search and coverage

The Spectral Image Search supports a single target or a list of targets; spatial relations include observation boundary containing a point, containing a requested shape, or being contained by a shape. Polygon vertices are J2000 RA/Dec pairs (3–15 vertices). Large requested regions can return no observations when the service requires the observation to cover the whole requested shape. A position constraint can be disabled to search by time or wavelength alone; this can include calibration products without sky positions that positional searches omit. [Searching](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/searching.html)

Coordinates may be entered in supported name or coordinate forms, and the interface displays its interpretation. Preserve the resolved J2000 coordinate and input representation in query provenance. Do not silently treat a name resolver's coordinate as the user's exact input. Multi-target search takes a loaded or uploaded table and may require explicit selection of its RA and Dec columns. [Searching](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/searching.html) · [Upload](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/upload.html)

Search constraints include time ranges in UTC or MJD, relative recent-time intervals, a detector band, a wavelength value, or an overlapping wavelength interval. Archive delivery is described as approximately weekly, so a recent query may not include the latest observations. “No results” means no matching products in the queried release/service under those constraints, not proof of no observation or no source. Record the collection, constraints, query time, and result count. [Searching](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/searching.html)

IRSA's browser workflow defaults to a HiPS coverage view and can show MOC coverage. The sky's scan pattern is easier to interpret in ecliptic coordinates, while users commonly work in equatorial or galactic coordinates; projection and coordinate frame can make a valid footprint look unexpected. Coverage maps are discovery aids, not substitutes for per-exposure footprints and data masks. [Overview](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/overview.html) · [Visualization](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/visualization.html)

## Results and linked views

Search results use linked panes: observation/result tables on one side and image, detail, coverage, or plot views on the other. Selecting a row changes the associated views. Repeated searches append result tabs rather than necessarily replacing earlier results. Capture the query-to-result association explicitly in a client; do not infer that the currently visible table represents only the latest query. [Search Results](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/results.html)

An image set can contain the paired simultaneous bands. Results, spectrophotometry, and mosaic outputs may populate different tabs and panes. The UI also offers observation-level product lookup and links to external services. Treat those as navigation/actions over archive records, not as products already loaded into the local app. [Search Results](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/results.html) · [Tables](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/tables.html)

## Upload and input files

The help documents uploads from local disk, URL, or IRSA Workspace, and loaded tables can be reused for target lists and searches. Relevant formats include IPAC tables and common table formats, FITS images including multi-extension FITS, DS9 region files, MOCs, data-link tables, UWS job files, and spectrum files. A table intended to be recognized as a positioned catalog needs coordinate columns; the tool may assume J2000 when no frame is supplied. State coordinate column names and frames explicitly in Spectra's own upload flow. [Upload](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/upload.html)

For a target-list workflow, validate required columns, finite coordinates, coordinate frame, units, duplicate identifiers, and row count before dispatch. Do not assume that successful parsing means the source model or position is scientifically adequate. Workspace authentication is an IRSA product detail and must not be copied into Spectra's zero-auth public workflow. [Upload](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/upload.html) · [Spectrophotometry](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html)

## Visualization and FITS cubes

The viewer can switch between HiPS and FITS layers, move a cutout center, change coordinate system/projection, inspect headers, and step through image HDUs and cube planes. HDU and plane selectors are independent. A mosaic example contains IMAGE, NHITS, and FLAGS HDUs, each with 102 wavelength planes; spectral images can also contain a PSF cube whose planes index detector regions rather than wavelength. Never assign wavelength semantics to a cube axis without inspecting its headers/product definition. [Visualization](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/visualization.html)

Image layers, footprints, markers, catalogs, masks, and linked zoom/pan views help compare coverage and sources. FITS rendering is a view transformation; it must not be confused with science arithmetic on the original pixel values. For extracted cutouts, preserve WCS and extension metadata and verify the resulting footprint against the parent image. The dedicated cutout documentation emphasizes correctly handling multi-extension products and spectral integrity. [Visualization](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/visualization.html) · [SPHEREx Cutout Tool](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html)

## Tables, catalogs, and other searches

IRSA's result, catalog, and FITS-header tables share interactive behaviors: sorting, filtering, selecting rows, column visibility, row details, and derived columns. Derived columns are calculated values, not spreadsheet formulas that update automatically. Table filters and plot selections can affect linked image overlays. Preserve original values and identify derived columns clearly when exporting. [Tables](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/tables.html)

The Catalogs interface supports catalog selection and spatial searches (cone, ellipse, box, polygon, multi-object, and all-sky where available), plus column constraints. Large result sets may be slower and may be grouped in the visualization until zoomed in. Apply selective spatial and column constraints before fetching/rendering large catalogs. [Catalogs](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/catalogs.html)

Other Searches include TAP/ADQL, ObsCore/ObsTAP, VO Simple Cone Search, and name/object-ID matching. These expose heterogeneous external services: coordinate columns, ID types, row limits, service uptime, and query semantics differ. Disable spatial matching for ID-only matching, use exact compatible ID types, and retain the service URL/query and returned row cap. These are useful interoperability patterns but are not interchangeable with SPHEREx spectral-image search. [Other Searches](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/othersearches.html)

## Plots and spectra

Generic catalog plots can use table columns or supported arithmetic expressions, error bars, logarithmic axes, filters, and overlays. Large catalogs default to binned plots above a documented point threshold; drawing every point can slow the browser. A responsive implementation should aggregate or downsample for display while preserving the full underlying table and making the aggregation visible. [Plots](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/plots.html)

Spectra are plotted as flux density versus wavelength, with units and uncertainty-aware options when the columns are recognized. Spectral plots support observed/rest-frame wavelength views and redshift controls. The table view contains additional metadata such as pixel location, observation time, and flags. Preserve these alongside wavelength and flux during export; plotting only the spectral line discards useful temporal and quality context. [Spectra](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/spectra.html)

Observation time can be mapped to point color to reveal that a spectrum was assembled over multiple epochs and to expose variability. This is especially important for variable or moving sources: a single flux-versus-wavelength curve can combine measurements from different dates. Provide per-sample MJD/exposure provenance and avoid implying simultaneity across the spectrum. [Spectra](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/spectra.html)

## Spectrophotometry

The Spectrophotometry Tool fits source flux across multiple spectral images; it is computationally more expensive than visualizing one exposure because it performs PSF-based fits and handles neighboring sources/background. It is an asynchronous job workflow. A fast “drill” extraction through a cube is explicitly a quick-look product and is not the same algorithm or product as spectrophotometry. Label extraction method and provenance. [Spectrophotometry](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html) · [FAQ](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/faq.html)

The documented fitter solves for flux while other source-model inputs must be supplied. It does not recenter input positions. Extended galaxies require reasonable morphology inputs (Sérsic index, axis ratio, position angle, effective radius); invalid values in batch catalogs may not be caught as thoroughly as single-source form entries. High proper motion, wrong epoch/equinox, duplicate source labels, or poor galaxy morphology can therefore produce bad fits. Validate inputs and surface fit/quality diagnostics instead of presenting every returned flux as equally reliable. [Spectrophotometry](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html)

Pinning a spectrum preserves it while exploring another source. Filters may be lost when the product is reloaded unless the spectrum is pinned first. Use the tool's Prepare Download action for a spectrum product; a generic table-save action may save only the currently visible source list. [Spectrophotometry](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html)

## Mosaics

The Mosaic Tool combines selected spectral images onto user-requested geometry, pixel scale, and wavelength range. The documented output has IMAGE (MJy/sr), NHITS (number of contributing input images), and FLAGS HDUs; each has wavelength planes. Selected input flags are propagated by bitwise OR, so output flags describe whether contributing input pixels carried those conditions. Keep the native flags and define any simplified UI mask mapping explicitly. [Mosaic](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/mosaic.html)

Mosaic cost rises with number of frames and output pixels. Ecliptic-pole areas can have many more frames; finer pixel scales and larger areas create more output pixels. Missing wavelength planes can reflect incomplete band coverage; stripes/artifacts can remain in sparse coverage. The service also limits concurrent jobs. Expose area, scale, selected exposures, expected output size, queue state, and coverage gaps before or during a long job. [Mosaic](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/mosaic.html)

The mosaic quick-look extraction/drill path is exploratory and must not be represented as equivalent to the full spectrophotometry procedure. The mosaic result is saved from the image toolbar in the IRSA UI; its Job Monitor and retention behavior are service-specific. [Mosaic](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/mosaic.html)

## Downloads, cutouts, and jobs

The IRSA UI distinguishes saving the visible table/image from preparing a downloadable science product. Search result downloads can package selected product types and run asynchronously; the Job Monitor tracks status and may issue completion notifications. Spectrophotometry has a dedicated Prepare Download action; mosaic output is saved from its image toolbar. Preserve this product-specific distinction in any Spectra download UI. [Downloading Data](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/downloads.html) · [Spectrophotometry](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html) · [Mosaic](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/mosaic.html)

The separate SPHEREx Cutout Service handles large multi-extension FITS products while preserving their HDU structure and metadata. Its direct URL form accepts a center and size; the service documentation and tutorials are the source of truth for parameters and product behavior. Cutouts reduce transfer and memory cost, but must retain correct subimage WCS (including reference-pixel offsets), all relevant extensions, and wavelength/variance/flag alignment. [Cutout Tool](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html)

Job persistence and concurrent-job limits are IRSA operational details and can change. The help describes jobs potentially expiring or disappearing after service maintenance and advises downloading completed products promptly. Spectra should make local job/result state explicit and avoid promising IRSA retention guarantees. [Downloading Data](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/downloads.html) · [Mosaic](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/mosaic.html)

## Examples and performance lessons

Useful examples from the manual include: search by coordinate/name; query only by time or wavelength; upload a multi-target table; inspect a selected exposure and its paired image; plot a large catalog as a heat map and refine it; color spectral points by MJD; compare a mosaic's IMAGE, NHITS, and FLAGS planes; and use a cutout for a local region. These examples imply progressive exploration: discover a limited set, inspect metadata/coverage, then request heavier derived products.

The documented causes of slowness are concrete: too many exposures, too many output pixels, large catalogs rendered as individual points, and expensive multi-image PSF fitting. A low-latency design should:

1. Query spatial/time/wavelength constraints before downloading image bytes.
2. Request a server-side cutout around the science target rather than fetch full detector frames when possible.
3. Keep heavy processing in bounded asynchronous jobs with visible queue/progress and cancellation.
4. Reuse/cache immutable exposure metadata and cutout products with release-aware keys.
5. Decode and process only needed HDUs and array regions; avoid repeated full-array copies and base64 encoding in the science path.
6. Render previews separately from raw float science arrays, and downsample large tables/plots for display.
7. Report the number of exposures, bytes, pixels, and processing stage so latency is diagnosable.

These are engineering implications drawn from the archive manual's workflow and stated cost drivers, not claims about IRSA's undocumented internal implementation.

## Implications for Spectra

- Treat spectral images as spatially varying wavelength samples, not six static broadband layers. Use product WCS/WAVE information for per-pixel wavelength assignment.
- Keep exposure-level MJD and discrete survey visits. A constructed spectrum may span months; communicate that temporal baseline.
- Preserve flux, variance, flags, exposure IDs, coordinate solution, release, and extraction method through cutouts, coadds, spectra, and downloads.
- Distinguish raw archive products, previews, quick-look drill extractions, mosaics, and PSF-fit spectrophotometry in both labels and APIs.
- Make data absence and partial wavelength coverage explicit. A blank plane is not zero flux, and a missing search match is not a non-detection.
- Bound request size and browser rendering independently. A responsive UI should not force scientific data to be irreversibly downsampled.
- Apply the repository's existing signed 32-bit FLAGS and binary tensor wire contracts as specified in `SPECIFICATION.md`; this guide does not override them or define new encodings.

## Source index

- [Online Help overview and terminology](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/overview.html)
- [Searching](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/searching.html)
- [Search Results](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/results.html)
- [Upload](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/upload.html)
- [Visualization](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/visualization.html)
- [Tables](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/tables.html)
- [Catalogs](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/catalogs.html)
- [Other Searches](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/othersearches.html)
- [Plots](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/plots.html)
- [Spectra](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/spectra.html)
- [Spectrophotometry Tool](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html)
- [Mosaic Tool](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/mosaic.html)
- [Downloading Data and Job Monitor](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/downloads.html)
- [FAQ](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/faq.html)
- [SPHEREx Cutout Tool](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html)
